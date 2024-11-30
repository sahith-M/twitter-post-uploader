const express = require('express');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const tweetSchedule = []; // To store scheduled tweets

// Middleware setup
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure session middleware
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'default_secret',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }, // Use `true` in production with HTTPS
    })
);

// PKCE helper functions
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// Multer configuration for file uploads
const upload = multer({ dest: 'uploads/' });

// Home route
app.get('/', (req, res) => {
    if (req.session.accessToken) {
        return res.redirect('/dashboard');
    }
    res.render('index'); // Ensure 'views/index.ejs' exists
});

// Twitter OAuth flow (Step 1: Redirect to Twitter)
app.get('/auth/twitter', (req, res) => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

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
                    ).toString('base64')}`,
                },
            }
        );

        const { access_token } = tokenResponse.data;

        req.session.accessToken = access_token;
        console.log('Access Token saved:', access_token);

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error during token exchange:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// Dashboard route
app.get('/dashboard', async (req, res) => {
    const accessToken = req.session.accessToken;

    if (!accessToken) {
        return res.redirect('/');
    }

    try {
        const tweetsResponse = await axios.get('https://api.twitter.com/2/users/me/tweets', {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { max_results: 5 },
        });

        const recentTweets = tweetsResponse.data.data || [];
        res.render('dashboard', { recentTweets });
    } catch (error) {
        const errorData = error.response?.data || error.message;
        if (error.response?.status === 429) {
            console.error('Rate limit reached. Try again later.');
            res.render('dashboard', {
                recentTweets: [],
                error: 'Rate limit reached. Try again later.',
            });
        } else {
            console.error('Error fetching tweets:', errorData);
            res.render('dashboard', { recentTweets: [], error: errorData });
        }
    }
});

// Post a tweet
app.post('/post', upload.single('image'), async (req, res) => {
    const accessToken = req.session.accessToken;

    if (!accessToken) {
        return res.status(400).send('Access Token is missing. Please log in again.');
    }

    try {
        let mediaId;

        // Upload image if provided
        if (req.file) {
            const formData = new FormData();
            formData.append('media', fs.createReadStream(req.file.path));

            const uploadResponse = await axios.post(
                'https://upload.twitter.com/1.1/media/upload.json',
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        Authorization: `Bearer ${accessToken}`,
                    },
                }
            );

            mediaId = uploadResponse.data.media_id_string;

            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
        }

        // Post tweet
        const tweetData = {
            text: req.body.caption,
        };

        if (mediaId) {
            tweetData.media = { media_ids: [mediaId] };
        }

        const tweetResponse = await axios.post(
            'https://api.twitter.com/2/tweets',
            tweetData,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        res.json(tweetResponse.data);
    } catch (error) {
        console.error('Error posting tweet:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// Schedule a tweet
app.post('/schedule', (req, res) => {
    const { caption, scheduleTime } = req.body;

    if (!caption || !scheduleTime) {
        return res.status(400).send('Caption and schedule time are required.');
    }

    if (!req.session.accessToken) {
        return res.status(401).send('User not authenticated.');
    }

    tweetSchedule.push({
        caption,
        scheduleTime,
        status: 'scheduled',
        accessToken: req.session.accessToken,
    });

    res.send('Tweet scheduled successfully!');
});

// Process scheduled tweets
setInterval(async () => {
    const now = new Date();

    for (const tweet of tweetSchedule) {
        if (tweet.status === 'scheduled' && new Date(tweet.scheduleTime) <= now) {
            try {
                const accessToken = tweet.accessToken;

                if (accessToken) {
                    await axios.post(
                        'https://api.twitter.com/2/tweets',
                        { text: tweet.caption },
                        { headers: { Authorization: `Bearer ${accessToken}` } }
                    );

                    tweet.status = 'posted';
                    console.log(`Tweet posted: ${tweet.caption}`);
                } else {
                    console.error('Access token missing for scheduled tweet.');
                }
            } catch (error) {
                console.error(
                    'Error posting scheduled tweet:',
                    error.response?.data || error.message
                );
            }
        }
    }
}, 60 * 1000); // Check every minute

// Error route
app.get('/failure', (req, res) => {
    const error = req.query.error || 'An unknown error occurred. Please try again.';
    res.render('failure', { error });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
