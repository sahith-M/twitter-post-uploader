const express = require('express');
const multer = require('multer');
const { TwitterApi } = require('twitter-api-v2');
const passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;
require('dotenv').config();

const app = express();

// Configure file uploads
const upload = multer({ dest: 'uploads/' });

// Twitter API client
let twitterClient;

// Passport strategy
passport.use(
  new TwitterStrategy(
    {
      consumerKey: process.env.TWITTER_API_KEY,
      consumerSecret: process.env.TWITTER_API_SECRET,
      callbackURL: 'http://localhost:3000/auth/twitter/callback',
    },
    (token, tokenSecret, profile, done) => {
      profile.token = token;
      profile.tokenSecret = tokenSecret;
      return done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Middleware setup
app.set('view engine', 'ejs'); // Use EJS for templates
app.use(express.static('public')); // Serve static files (CSS, images, etc.)
app.use(require('express-session')({ secret: process.env.SESSION_SECRET, resave: true, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/auth/twitter', passport.authenticate('twitter'));

app.get(
  '/auth/twitter/callback',
  passport.authenticate('twitter', { failureRedirect: '/failure' }),
  (req, res) => {
    const { token, tokenSecret } = req.user;
    twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: token,
      accessSecret: tokenSecret,
    });
    res.redirect('/dashboard');
  }
);

app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.render('dashboard', { user: req.user });
});

app.post('/post', upload.single('image'), async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const { caption } = req.body;

  try {
    const mediaId = await twitterClient.v1.uploadMedia(req.file.path);
    await twitterClient.v1.tweet(caption, { media_ids: mediaId });
    res.redirect('/success');
  } catch (err) {
    console.error(err);
    res.redirect('/failure');
  }
});

app.get('/success', (req, res) => res.render('success'));
app.get('/failure', (req, res) => res.render('failure'));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
