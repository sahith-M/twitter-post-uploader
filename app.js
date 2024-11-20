const express = require('express');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto'); // For PKCE
require('dotenv').config();

const app = express();
const multer = require('multer'); // Middleware for handling file uploads
const fs = require('fs'); // For file system operations

// Middleware setup
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure session middleware
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'default_secret', // Replace with a secure string
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }, // Use `secure: true` in production with HTTPS
    })
);

// PKCE helper functions
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url'); // Generate code_verifier
}

function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url'); // Generate code_challenge
}

// Multer configuration for file uploads
const upload = multer({ dest: 'uploads/' });

// Home route
app.get('/', (req, res) => {
    // Check if the user is logged in
    if (req.session.accessToken) {
        return res.redirect('/dashboard');
    }
    res.render('index'); // Ensure an 'index.ejs' file exists in the 'views' folder
});

// Dashboard route
app.get('/dashboard', (req, res) => {
    const token = req.session.accessToken;
    if (!token) {
        return res.redirect('/'); // Redirect to login if not authenticated
    }
    res.render('dashboard', { token }); // Ensure a 'dashboard.ejs' file exists
});

// Twitter OAuth flow (Step 1: Redirect to Twitter)
app.get('/auth/twitter', (req, res) => {
    const codeVerifier = generateCodeVerifier(); // Generate code_verifier
    const codeChallenge = generateCodeChallenge(codeVerifier); // Generate code_challenge

    // Save code_verifier in the session
    req.session.codeVerifier = codeVerifier;

    const authUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${process.env.CALLBACK_URL}&scope=tweet.write%20users.read%20tweet.read%20offline.access&state=random_state&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    res.redirect(authUrl);
});

// Twitter OAuth callback (Step 2: Exchange code for access token)
app.get('/auth/twitter/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
      return res.status(400).send('Authorization code is missing.');
  }

  const codeVerifier = req.session.codeVerifier;
  if (!codeVerifier) {
      return res.status(400).send('Code verifier is missing.');
  }

  try {
      const tokenResponse = await axios.post(
          'https://api.twitter.com/2/oauth2/token',
          new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: process.env.CALLBACK_URL,
              code_verifier: codeVerifier,
          }),
          {
              headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Authorization: `Basic ${Buffer.from(
                      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
                  ).toString('base64')}`, // Basic Auth Header
              },
          }
      );

      const { access_token } = tokenResponse.data;

      // Save access_token in the session
      req.session.accessToken = access_token;

      console.log('Access Token saved in session:', req.session.accessToken);

      res.redirect('/dashboard');
  } catch (error) {
      console.error('Error during token exchange:', error.response?.data || error.message);
      res.status(500).json({ error: error.response?.data || error.message });
  }
});


// Post a tweet
app.post('/post', upload.single('image'), async (req, res) => {
    const accessToken = req.session.accessToken;

    if (!accessToken) {
        console.error('Access Token is missing in session.');
        return res.status(400).send('Access Token is missing. Please log in again.');
    }

    try {
        const tweetResponse = await axios.post(
            'https://api.twitter.com/2/tweets',
            { text: req.body.caption },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        res.json(tweetResponse.data);
    } catch (error) {
        console.error('Error posting tweet:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// Error route
app.get('/failure', (req, res) => {
    const error = req.query.error || 'An unknown error occurred. Please try again.';
    res.render('failure', { error });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
