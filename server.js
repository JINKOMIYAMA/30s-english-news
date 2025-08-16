const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const newsRoutes = require('./api/news');
const ttsRoutes = require('./api/tts');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(__dirname));

// Audio files
app.use('/audio', express.static(path.join(__dirname, 'audio'), {
    maxAge: '1y', // 1年キャッシュ
    setHeaders: (res, filePath) => {
        if (path.extname(filePath) === '.mp3') {
            res.setHeader('Content-Type', 'audio/mpeg');
        }
    }
}));

// API Routes
app.use('/api/news', newsRoutes);
app.use('/api/tts', ttsRoutes);

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 30s English News Server running on port ${PORT}`);
    console.log(`📱 Access at: http://localhost:${PORT}`);
    console.log(`🌐 Network access: http://192.168.179.21:${PORT}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV}`);
});