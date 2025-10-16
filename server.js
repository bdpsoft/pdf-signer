import express from "express";
import multer from "multer";
import nodemailer from "nodemailer";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import passport from "./auth.js";



dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: "uploads/" });
const dbFile = "db.json";

if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, "[]");

const loadDB = () => JSON.parse(fs.readFileSync(dbFile, "utf8"));
const saveDB = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));

// Staticki folderi za serviraanje PDF-a
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/signed", express.static(path.join(__dirname, "signed")));

// Sessions & passport
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("views"));

// Auth routes
app.get("/auth/login", (req, res, next) => {
  // Sačuvaj originalni URL pre nego što krenemo na Microsoft login
  req.session.returnTo = req.session.returnTo || req.query.returnTo || "/";
  passport.authenticate("microsoft")(req, res, next);
});
app.all(
  "/auth/callback",
  passport.authenticate("microsoft", { failureRedirect: "/" }),
 (req, res) => {
    // nakon logina, preusmeri korisnika na prethodni URL ako postoji
    const redirectUrl = req.session.returnTo || "/";
    delete req.session.returnTo;
    res.redirect(redirectUrl);
  }
);
app.get("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    const logoutUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(process.env.BASE_URL)}`;
    res.redirect(logoutUrl);
  });
});
app.get("/pdf/:id", ensureAuthenticated, (req, res) => {
  const db = loadDB();
  const entry = db.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).send("PDF not found");

  const filePath = entry.signed ? entry.signedFile : entry.file;

  if (!fs.existsSync(filePath)) return res.status(404).send("File missing");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=" + path.basename(filePath))+".pdf";
  res.sendFile(path.resolve(filePath));
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
// sačuvaj originalni URL
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/login");
}

// Email setup
// Email setup: support either OAuth2 (preferred) or plain app-password fallback.
let transporter;
if (
  process.env.OAUTH_CLIENT_ID &&
  process.env.OAUTH_CLIENT_SECRET &&
  process.env.OAUTH_REFRESH_TOKEN &&
  process.env.EMAIL_USER
) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.EMAIL_USER,
      clientId: process.env.OAUTH_CLIENT_ID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      refreshToken: process.env.OAUTH_REFRESH_TOKEN
    }
  });
} else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  // Plain username/password (use Gmail App Passwords if the account has 2FA enabled)
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
} else {
  console.warn("No email credentials provided in environment. Email sending will be disabled.");
  // Minimal stub so code won't crash; sendMail will throw and be handled where used
  transporter = {
    sendMail: () => Promise.reject(new Error("Email not configured")),
    verify: () => Promise.resolve(false)
  };
}

// Verify transporter at startup and give actionable logging
if (transporter && typeof transporter.verify === "function") {
  transporter
    .verify()
    .then((ok) => {
      if (ok) console.log("✅ Email transporter is ready");
      else console.log("⚠️ Email transporter verification returned false");
    })
    .catch((err) => {
      console.error("❌ Email transporter verification failed:", err && err.message ? err.message : err);
      console.error(
        "If you're using Gmail: enable 2FA and create an App Password, or set up OAuth2 credentials (OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REFRESH_TOKEN). See README for details."
      );
    });
}

// Upload page
app.get("/", ensureAuthenticated, (req, res) =>
  res.sendFile(path.resolve("views/upload.html"))
);

// Upload + add fields
app.post("/upload", ensureAuthenticated, upload.single("pdf"), async (req, res) => {
  const { email } = req.body;
  const id = uuidv4();

  const pdfBytes = fs.readFileSync(req.file.path);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const fields = [
    { name: "FullName", x: 150, y: 500 },
    { name: "Date", x: 150, y: 470 },
    { name: "Company", x: 150, y: 440 }
  ];

  fields.forEach(f => {
    const tf = form.createTextField(f.name);
    tf.setText("");
    tf.addToPage(page, { x: f.x, y: f.y, width: 200, height: 20 });
  });

  form.updateFieldAppearances(font);
  const pdfWithFields = await pdfDoc.save();
  fs.writeFileSync(req.file.path, pdfWithFields);

  const db = loadDB();
  db.push({ id, file: req.file.path, email, signed: false });
  saveDB(db);

  const signLink = `${process.env.BASE_URL}/sign/${id}`;
  try {
    await transporter.sendMail({
      to: email,
      subject: "Sign your document",
      html: `<p>Click to sign your PDF: <a href="${signLink}">Sign Document</a></p>`
    });
    res.send("PDF prepared and email sent!");
  } catch (err) {
    console.error("Failed to send email:", err && err.message ? err.message : err);
    // Common Gmail SMTP error: EAUTH / 535 - Bad credentials
    if (err && err.responseCode === 535) {
      res.status(500).send(
        "Email authentication failed (535). If you use Gmail, either create an App Password (if your account has 2FA) or configure OAuth2. Check SERVER logs for details."
      );
    } else {
      res.status(500).send("Failed to send email. Check server logs for details.");
    }
  }
});

// Sign view
app.get("/sign/:id", ensureAuthenticated, (req, res) => {
  res.sendFile(path.resolve("views/sign.html"));
});

// Save signed PDF
app.post("/sign/:id", ensureAuthenticated, async (req, res) => {
  const { signatureDataUrl, values } = req.body;
  const db = loadDB();
  const entry = db.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).send("Not found");

  const pdfBytes = fs.readFileSync(entry.file);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const page = pdfDoc.getPages()[0];

  Object.entries(values || {}).forEach(([key, val]) => {
    try {
      form.getTextField(key).setText(val);
    } catch {}
  });

  form.flatten();

  const sigImg = await pdfDoc.embedPng(
    Buffer.from(signatureDataUrl.split(",")[1], "base64")
  );
  page.drawImage(sigImg, { x: 50, y: 50, width: 150, height: 50 });

  const signedPdf = await pdfDoc.save();
  const signedPath = `signed/${entry.id}_signed.pdf`;
  fs.writeFileSync(signedPath, signedPdf);

  entry.signed = true;
  entry.signedFile = signedPath;
  saveDB(db);

  res.json({ message: "Signed and archived", file: signedPath });
});

app.listen(3000, () =>
  console.log("✅ Running at http://localhost:3000 (Ctrl+C to stop)")
);
