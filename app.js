const express = require('express');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto'); // For PKCE
require('dotenv').config();

const app = express();
const multer = require('multer'); // Middleware for handling file uploads
const fs = require('fs'); // For file system operations

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
    session({
      secret: process.env.SESSION_SECRET || 'randomsecret', // Replace with a secure secret
      resave: false,
      saveUninitialized: true,
    })
  );

// Configure multer to store uploaded files in the 'uploads' folder
const upload = multer({ dest: 'uploads/' });

app.post('/post', upload.single('image'), async (req, res) => {
    console.log('Session data at /post:', req.session); // Log session data
    const accessToken = req.session.accessToken;
  
    if (!accessToken) {
      console.error('Access Token is missing in session.');
      return res.redirect(`/failure?error=${encodeURIComponent('User is not authenticated. Please log in again.')}`);
    }
  
    const { caption } = req.body;
  
    if (!req.file) {
      console.error('Image file is missing.');
      return res.redirect(`/failure?error=${encodeURIComponent('Image file is required.')}`);
    }
  
    try {
      // Step 1: Upload the image to Twitter
      const mediaUploadResponse = await axios.post(
        `${process.env.TWITTER_API_URL}/1.1/media/upload.json`,
        fs.createReadStream(req.file.path),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );
  
      const mediaId = mediaUploadResponse.data.media_id_string;
  
      // Step 2: Post the Tweet with the media
      await axios.post(
        `${process.env.TWITTER_API_URL}/2/tweets`,
        {
          text: caption,
          media: { media_ids: [mediaId] },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
  
      // Step 3: Clean up the uploaded file
      fs.unlinkSync(req.file.path);
  
      res.redirect('/success');
    } catch (error) {
      console.error('Error posting tweet:', error.response?.data || error.message);
      res.redirect(`/failure?error=${encodeURIComponent('Failed to post tweet. Please try again.')}`);
    }
  });
  
  


// Middleware setup
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
    session({
      secret: process.env.SESSION_SECRET || 'randomsecret', // Replace with a secure secret
      resave: false,
      saveUninitialized: true,
    })
  );

function generateCodeVerifier() {
  const randomString = crypto.randomBytes(32).toString('hex');
  return randomString;
}

function generateCodeChallenge(codeVerifier) {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

app.get('/', (req, res) => {
    // Check if the user is logged in (access token exists)
    if (req.session.accessToken) {
      return res.redirect('/dashboard'); // Redirect logged-in users to the dashboard
    }
    // Render the login page
    res.render('index'); // Ensure there's an 'index.ejs' file in the 'views' folder
  });
  app.get('/dashboard', (req, res) => {
    // Check if the user is authenticated
    if (!req.session.accessToken) {
      return res.redirect('/'); // Redirect to login if not authenticated
    }
  
    // Render the dashboard page
    res.render('dashboard', { user: req.session.user || 'User' });
  });
  

// Step 1: Redirect to Twitter for authentication
app.get('/auth/twitter', (req, res) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  req.session.codeVerifier = codeVerifier;

  const authUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${process.env.CALLBACK_URL}&scope=tweet.read%20tweet.write%20users.read%20offline.access&state=random_state_string&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  res.redirect(authUrl);
});

// Step 2: Handle Twitter callback
app.get('/auth/twitter/callback', async (req, res) => {
    const { code, error } = req.query;
  
    if (error) {
      console.error('Twitter returned an error:', error);
      return res.redirect(`/failure?error=${encodeURIComponent('Authorization failed. Please try again.')}`);
    }
  
    if (!code) {
      console.error('Authorization code missing.');
      return res.redirect(`/failure?error=${encodeURIComponent('Authorization code missing. Please try again.')}`);
    }
  
    try {
      const codeVerifier = req.session.codeVerifier;
  
      if (!codeVerifier) {
        throw new Error('Code verifier is missing in the session.');
      }
  
      const tokenResponse = await axios.post(
        `${process.env.TWITTER_API_URL}/2/oauth2/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: process.env.CALLBACK_URL,
          client_id: process.env.TWITTER_CLIENT_ID,
          client_secret: process.env.TWITTER_CLIENT_SECRET,
          code_verifier: codeVerifier,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(
              `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
            ).toString('base64')}`,
          },
        }
      );
  
      console.log('Token exchange response:', tokenResponse.data);
  
      // Save accessToken in session
      req.session.accessToken = tokenResponse.data.access_token;
      console.log('Access Token saved in session:', req.session.accessToken);
  
      res.redirect('/dashboard');
    } catch (exchangeError) {
      console.error('Error exchanging code for token:', exchangeError.response?.data || exchangeError.message);
      res.redirect(`/failure?error=${encodeURIComponent('Token exchange failed. Please try again.')}`);
    }
  });
  
app.get('/failure', (req, res) => {
    const error = req.query.error || 'An unknown error occurred. Please try again.';
    res.render('failure', { error });
  });
  

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
