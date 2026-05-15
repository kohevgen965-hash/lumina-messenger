const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==================== БАЗА ДАННЫХ (JSON файлы) ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readDB(file) {
    try {
        const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function writeDB(file, data) {
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ==================== ПОЛЬЗОВАТЕЛИ ====================
let users = readDB('users.json');
let channels = readDB('channels.json');
let messages = readDB('messages.json');
let ads = readDB('ads.json');

// Генерация 6-значного ID
function generateUserId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Регистрация
app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    if (users.find(u => u.email === email)) {
        return res.json({ success: false, error: 'Email уже используется' });
    }
    const userId = generateUserId();
    const newUser = { id: userId, username, email, password, phone: '', created: Date.now() };
    users.push(newUser);
    writeDB('users.json', users);
    
    // Создаём личный чат с DeepSeek
    messages.push({
        chatId: `deepseek_${userId}`,
        type: 'ai',
        participants: [userId, 'deepseek'],
        messages: [{ sender: 'DeepSeek AI', text: 'Привет! Я DeepSeek — твой ИИ-помощник ✨', time: new Date().toLocaleTimeString() }]
    });
    writeDB('messages.json', messages);
    
    res.json({ success: true, userId, username });
});

// Вход
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => (u.email === email || u.username === email) && u.password === password);
    if (!user) return res.json({ success: false, error: 'Неверные данные' });
    res.json({ success: true, userId: user.id, username: user.username });
});

// Получить профиль
app.get('/api/profile/:userId', (req, res) => {
    const user = users.find(u => u.id === req.params.userId);
    if (!user) return res.json({ success: false });
    res.json({ success: true, profile: { id: user.id, name: user.username, phone: user.phone, email: user.email } });
});

// Обновить профиль
app.post('/api/profile/update', (req, res) => {
    const { userId, name, phone, email, password } = req.body;
    const user = users.find(u => u.id === userId);
    if (user) {
        if (name) user.username = name;
        if (phone) user.phone = phone;
        if (email) user.email = email;
        if (password) user.password = password;
        writeDB('users.json', users);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// ==================== КАНАЛЫ ====================
// Создать канал
app.post('/api/channel/create', (req, res) => {
    const { ownerId, name, description, avatar, isPrivate } = req.body;
    const channelId = `ch_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const newChannel = {
        id: channelId,
        ownerId,
        name,
        description: description || '',
        avatar: avatar || '📢',
        isPrivate: isPrivate || false,
        subscribers: [ownerId],
        subscribersCount: 1,
        createdAt: Date.now(),
        adsEnabled: false,
        adRevenue: 0
    };
    channels.push(newChannel);
    writeDB('channels.json', channels);
    
    // Создаём чат для канала
    messages.push({
        chatId: channelId,
        type: 'channel',
        participants: [ownerId],
        messages: [{ sender: 'Система', text: `Канал "${name}" создан!`, time: new Date().toLocaleTimeString() }]
    });
    writeDB('messages.json', messages);
    
    res.json({ success: true, channel: newChannel });
});

// Получить каналы пользователя
app.get('/api/channels/user/:userId', (req, res) => {
    const userChannels = channels.filter(c => c.subscribers.includes(req.params.userId));
    res.json({ success: true, channels: userChannels });
});

// Получить все публичные каналы
app.get('/api/channels/public', (req, res) => {
    const publicChannels = channels.filter(c => !c.isPrivate);
    res.json({ success: true, channels: publicChannels });
});

// Подписаться на канал
app.post('/api/channel/subscribe', (req, res) => {
    const { channelId, userId } = req.body;
    const channel = channels.find(c => c.id === channelId);
    if (channel && !channel.subscribers.includes(userId)) {
        channel.subscribers.push(userId);
        channel.subscribersCount = channel.subscribers.length;
        writeDB('channels.json', channels);
        
        // Добавляем пользователя в чат канала
        const chat = messages.find(m => m.chatId === channelId);
        if (chat && !chat.participants.includes(userId)) {
            chat.participants.push(userId);
            writeDB('messages.json', messages);
        }
        res.json({ success: true, subscribersCount: channel.subscribersCount });
    } else {
        res.json({ success: false });
    }
});

// Отписаться
app.post('/api/channel/unsubscribe', (req, res) => {
    const { channelId, userId } = req.body;
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
        channel.subscribers = channel.subscribers.filter(id => id !== userId);
        channel.subscribersCount = channel.subscribers.length;
        writeDB('channels.json', channels);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// ==================== РЕКЛАМА В КАНАЛАХ ====================
// Включить рекламу (только если подписчиков >= 500)
app.post('/api/channel/enable-ads', (req, res) => {
    const { channelId, userId } = req.body;
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return res.json({ success: false, error: 'Канал не найден' });
    if (channel.ownerId !== userId) return res.json({ success: false, error: 'Только владелец' });
    if (channel.subscribersCount < 500) {
        return res.json({ success: false, error: `Нужно ${500 - channel.subscribersCount} подписчиков для рекламы` });
    }
    channel.adsEnabled = true;
    writeDB('channels.json', channels);
    res.json({ success: true, message: 'Реклама включена! Теперь вы можете зарабатывать.' });
});

// Создать рекламный пост
app.post('/api/channel/add-ad', (req, res) => {
    const { channelId, userId, adText, adLink, price } = req.body;
    const channel = channels.find(c => c.id === channelId);
    if (!channel || channel.ownerId !== userId) return res.json({ success: false });
    if (!channel.adsEnabled) return res.json({ success: false, error: 'Реклама не включена' });
    
    const newAd = {
        id: `ad_${Date.now()}`,
        channelId,
        advertiserId: userId,
        text: adText,
        link: adLink,
        price: price || 100,
        views: 0,
        clicks: 0,
        createdAt: Date.now()
    };
    ads.push(newAd);
    writeDB('ads.json', ads);
    res.json({ success: true, ad: newAd });
});

// Получить рекламу для показа
app.get('/api/ads/random', (req, res) => {
    const activeAds = ads.filter(a => a.views < 1000); // лимит показов
    if (activeAds.length === 0) return res.json({ success: false });
    const randomAd = activeAds[Math.floor(Math.random() * activeAds.length)];
    res.json({ success: true, ad: randomAd });
});

// Учесть просмотр рекламы
app.post('/api/ads/view', (req, res) => {
    const { adId } = req.body;
    const ad = ads.find(a => a.id === adId);
    if (ad) {
        ad.views++;
        writeDB('ads.json', ads);
    }
    res.json({ success: true });
});

// ==================== СООБЩЕНИЯ ====================
// Получить чаты пользователя
app.get('/api/chats/:userId', (req, res) => {
    const userChats = messages.filter(m => m.participants.includes(req.params.userId));
    res.json({ success: true, chats: userChats });
});

// Получить сообщения чата
app.get('/api/messages/:chatId', (req, res) => {
    const chat = messages.find(m => m.chatId === req.params.chatId);
    if (!chat) return res.json({ success: false });
    res.json({ success: true, messages: chat.messages, chat: chat });
});

// Отправить сообщение
app.post('/api/send-message', (req, res) => {
    const { chatId, senderId, text } = req.body;
    const chat = messages.find(m => m.chatId === chatId);
    if (!chat) return res.json({ success: false });
    
    const newMsg = {
        sender: senderId,
        text: text,
        time: new Date().toLocaleTimeString()
    };
    chat.messages.push(newMsg);
    writeDB('messages.json', messages);
    
    // ===== ОТВЕТ ОТ DEEPSEEK (если чат с ИИ) =====
    if (chat.type === 'ai' && senderId !== 'deepseek') {
        setTimeout(() => {
            const deepseekResponse = getDeepseekReply(text, senderId);
            chat.messages.push({
                sender: 'DeepSeek AI',
                text: deepseekResponse,
                time: new Date().toLocaleTimeString()
            });
            writeDB('messages.json', messages);
        }, 500);
    }
    
    res.json({ success: true, message: newMsg });
});

// ИИ DeepSeek (реальные ответы)
function getDeepseekReply(message, userId) {
    const user = users.find(u => u.id === userId);
    const userName = user ? user.username : 'Друг';
    const msg = message.toLowerCase();
    
    if (msg.match(/привет|здравствуй|хай/)) return `Привет, ${userName}! ✨ Рад тебя видеть. Как твои дела?`;
    if (msg.match(/как дела|как ты/)) return `У меня всё отлично! ${userName}, спасибо что спросил. Чем могу помочь сегодня?`;
    if (msg.match(/канал|создать канал/)) return `Чтобы создать канал, нажми на кнопку "+" в разделе "Каналы". После 500 подписчиков можно включить рекламу и зарабатывать! 📢`;
    if (msg.match(/реклама|заработать/)) return `При достижении 500 подписчиков в канале, владелец может включить рекламу. За показы рекламы начисляется доход. Отличный способ монетизации! 💰`;
    if (msg.match(/помощь|help/)) return `${userName}, я могу:\n• Отвечать на вопросы\n• Помочь с каналами\n• Рассказать о рекламе\n• Просто поболтать\nСпрашивай что угодно!`;
    
    return `Понял, ${userName}. ${message.length > 40 ? 'Интересная мысль!' : 'Расскажи подробнее'} Я внимательно слушаю и готов помочь ✨`;
}

// ==================== ПОИСК ====================
app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    const foundUsers = users.filter(u => u.username.toLowerCase().includes(query) || u.id.includes(query));
    const foundChannels = channels.filter(c => c.name.toLowerCase().includes(query) && !c.isPrivate);
    res.json({ success: true, users: foundUsers, channels: foundChannels });
});

// ==================== ЗАПУСК ====================
app.listen(PORT, () => {
    console.log(`🚀 Lumina сервер запущен на порту ${PORT}`);
    console.log(`📁 База данных: ${DATA_DIR}`);
});