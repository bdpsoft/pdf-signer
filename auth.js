import passport from "passport";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import dotenv from "dotenv";
dotenv.config();

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new MicrosoftStrategy(
    {
      clientID: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL}/auth/callback`,
      scope: ["openid", "profile", "email", "User.Read"],
      tenant: process.env.AZURE_TENANT_ID
    },
    (accessToken, refreshToken, profile, done) => done(null, profile)
  )
);

export default passport;
