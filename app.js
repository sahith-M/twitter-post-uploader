const express = require('express');
const passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;
const multer = require('multer');
const { TwitterApi } = require('twitter-api-v2');
const session = require('express-session');
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' }); // File upload directory

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Twitter OAuth Configuration
passport.use(
  new TwitterStrategy(
    {
      consumerKey: process.env.TWITTER_CLIENT_ID,
      consumerSecret: process.env.TWITTER_CLIENT_SECRET,
      callbackURL: process.env.CALLBACK_URL,
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

// Routes
app.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('index');
});

app.get('/auth/twitter', passport.authenticate('twitter'));

app.get(
  '/auth/twitter/callback',
  passport.authenticate('twitter', { failureRedirect: '/failure' }),
  (req, res) => {
    req.session.token = req.user.token;
    req.session.tokenSecret = req.user.tokenSecret;
    res.redirect('/dashboard');
  }
);

app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.render('dashboard', { user: req.user });
});

app.post('/post', upload.single('image'), async (req, res) => {
  const client = new TwitterApi({
    appKey: process.env.TWITTER_CLIENT_ID,
    appSecret: process.env.TWITTER_CLIENT_SECRET,
    accessToken: req.session.token,
    accessSecret: req.session.tokenSecret,
  });

  try {
    if (!req.file || !fs.existsSync(req.file.path)) {
      throw new Error('File not found or upload failed');
    }

    // Upload media to Twitter
    const mediaId = await client.v1.uploadMedia(req.file.path);

    // Post the tweet
    await client.v1.tweet(req.body.caption, { media_ids: mediaId });
    res.redirect('/success');
  } catch (error) {
    console.error('Error posting to Twitter:', error);
    res.redirect('/failure');
  }
});

app.get('/success', (req, res) => {
  res.render('success', { message: 'Your tweet was posted successfully!' });
});

app.get('/failure', (req, res) => {
  res.render('failure', { error: 'An error occurred. Please try again.' });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
