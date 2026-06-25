const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// ========== پسورد ادمین ==========
const ADMIN_PASSWORD = '4TOON2024';

// ========== اتاق‌ها ==========
const rooms = {};

// ========== Socket.IO ==========
io.on('connection', (socket) => {
    console.log('🟢 کاربر وصل شد:', socket.id);

    // ====== ایجاد اتاق ======
    socket.on('create-room', ({ roomName, userName }) => {
        // پاک کردن اتاق‌های خالی
        for (const [id, room] of Object.entries(rooms)) {
            if (room.users.length === 0) {
                delete rooms[id];
            }
        }
        
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        socket.join(roomId);
        
        rooms[roomId] = {
            name: roomName || 'اتاق جدید',
            adminId: socket.id,
            users: [{
                id: socket.id,
                name: userName || 'ناشناس',
                isAdmin: true
            }],
            messages: [],
            images: [],
            bannedUsers: []
        };
        
        socket.emit('room-created', roomId);
        socket.emit('users-update', rooms[roomId].users);
        socket.emit('chat-history', rooms[roomId].messages);
        socket.emit('images-update', rooms[roomId].images);
        socket.emit('you-are-admin', true);
        
        console.log(`🏠 اتاق ${roomId} توسط ${userName} ساخته شد`);
    });

    // ====== پیوستن به اتاق ======
    socket.on('join-room', ({ roomId, userName }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('error', '❌ اتاق وجود ندارد!');
            return;
        }
        
        if (room.users.length >= 10) {
            socket.emit('error', '❌ اتاق پر است!');
            return;
        }
        
        if (room.bannedUsers.includes(socket.id)) {
            socket.emit('error', '🚫 شما از این اتاق بن شده‌اید!');
            return;
        }
        
        if (room.users.find(u => u.id === socket.id)) {
            socket.emit('error', '❌ شما قبلاً در این اتاق هستید!');
            return;
        }
        
        socket.join(roomId);
        room.users.push({
            id: socket.id,
            name: userName || 'ناشناس',
            isAdmin: false
        });
        
        io.to(roomId).emit('user-joined', room.users);
        io.to(roomId).emit('users-update', room.users);
        socket.emit('chat-history', room.messages);
        socket.emit('images-update', room.images);
        
        console.log(`👤 ${userName} به اتاق ${roomId} پیوست`);
    });

    // ====== سیگنالینگ WebRTC ======
    socket.on('signal', ({ roomId, data }) => {
        socket.to(roomId).emit('signal', { 
            from: socket.id, 
            data: data 
        });
    });

    // ====== پیام چت ======
    socket.on('chat-message', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const user = room.users.find(u => u.id === socket.id);
        const msg = {
            id: Date.now(),
            userId: socket.id,
            user: user ? user.name : 'ناشناس',
            message: message,
            time: new Date().toLocaleTimeString('fa-IR')
        };
        
        room.messages.push(msg);
        io.to(roomId).emit('chat-message', msg);
    });

    // ====== اشتراک عکس ======
    socket.on('share-image', ({ roomId, imageData, fileName }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const user = room.users.find(u => u.id === socket.id);
        const image = {
            id: Date.now(),
            userId: socket.id,
            user: user ? user.name : 'ناشناس',
            data: imageData,
            fileName: fileName || 'عکس',
            time: new Date().toLocaleTimeString('fa-IR')
        };
        
        room.images.push(image);
        io.to(roomId).emit('new-image', image);
    });

    // ====== قابلیت‌های ادمین ======
    
    socket.on('admin-delete-message', ({ roomId, messageId, password }) => {
        if (password !== ADMIN_PASSWORD) {
            socket.emit('error', '❌ پسورد اشتباه است!');
            return;
        }
        const room = rooms[roomId];
        if (!room) return;
        if (room.adminId !== socket.id) {
            socket.emit('error', '❌ فقط ادمین می‌تونه پیام حذف کنه!');
            return;
        }
        
        const index = room.messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            room.messages.splice(index, 1);
            io.to(roomId).emit('message-deleted', messageId);
            io.to(roomId).emit('notification', '🗑️ یک پیام توسط ادمین حذف شد.');
        }
    });

    socket.on('admin-clear-chat', ({ roomId, password }) => {
        if (password !== ADMIN_PASSWORD) {
            socket.emit('error', '❌ پسورد اشتباه است!');
            return;
        }
        const room = rooms[roomId];
        if (!room) return;
        if (room.adminId !== socket.id) {
            socket.emit('error', '❌ فقط ادمین می‌تونه چت رو پاک کنه!');
            return;
        }
        
        room.messages = [];
        io.to(roomId).emit('chat-cleared');
        io.to(roomId).emit('notification', '🗑️ همه‌ی پیام‌ها توسط ادمین پاک شد.');
    });

    socket.on('admin-delete-image', ({ roomId, imageId, password }) => {
        if (password !== ADMIN_PASSWORD) {
            socket.emit('error', '❌ پسورد اشتباه است!');
            return;
        }
        const room = rooms[roomId];
        if (!room) return;
        if (room.adminId !== socket.id) {
            socket.emit('error', '❌ فقط ادمین می‌تونه عکس حذف کنه!');
            return;
        }
        
        const index = room.images.findIndex(img => img.id === imageId);
        if (index !== -1) {
            room.images.splice(index, 1);
            io.to(roomId).emit('image-deleted', imageId);
            io.to(roomId).emit('notification', '🗑️ یک عکس توسط ادمین حذف شد.');
        }
    });

    socket.on('admin-ban-user', ({ roomId, userId, password }) => {
        if (password !== ADMIN_PASSWORD) {
            socket.emit('error', '❌ پسورد اشتباه است!');
            return;
        }
        const room = rooms[roomId];
        if (!room) return;
        if (room.adminId !== socket.id) {
            socket.emit('error', '❌ فقط ادمین می‌تونه کاربر رو بن کنه!');
            return;
        }
        if (userId === socket.id) {
            socket.emit('error', '❌ نمی‌تونی خودت رو بن کنی!');
            return;
        }
        
        room.bannedUsers.push(userId);
        const userIndex = room.users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            const bannedUser = room.users[userIndex];
            room.users.splice(userIndex, 1);
            io.to(roomId).emit('users-update', room.users);
            io.to(roomId).emit('notification', `🚫 ${bannedUser.name} توسط ادمین بن شد.`);
            
            const targetSocket = io.sockets.sockets.get(userId);
            if (targetSocket) {
                targetSocket.emit('you-are-banned', 'شما توسط ادمین بن شدید!');
                targetSocket.disconnect(true);
            }
        }
    });

    socket.on('admin-announce', ({ roomId, message, password }) => {
        if (password !== ADMIN_PASSWORD) {
            socket.emit('error', '❌ پسورد اشتباه است!');
            return;
        }
        const room = rooms[roomId];
        if (!room) return;
        if (room.adminId !== socket.id) {
            socket.emit('error', '❌ فقط ادمین می‌تونه اعلامیه بده!');
            return;
        }
        
        io.to(roomId).emit('announcement', {
            text: message,
            time: new Date().toLocaleTimeString('fa-IR')
        });
        io.to(roomId).emit('notification', `📢 اعلامیه: ${message}`);
    });

    // ====== قطع شدن ======
    socket.on('disconnect', () => {
        console.log('🔴 کاربر قطع شد:', socket.id);
        
        for (const [roomId, room] of Object.entries(rooms)) {
            const userIndex = room.users.findIndex(u => u.id === socket.id);
            if (userIndex !== -1) {
                room.users.splice(userIndex, 1);
                io.to(roomId).emit('user-left', room.users);
                io.to(roomId).emit('users-update', room.users);
                
                if (room.users.length === 0) {
                    delete rooms[roomId];
                    console.log(`🗑️ اتاق ${roomId} حذف شد`);
                } else if (room.adminId === socket.id) {
                    room.adminId = room.users[0].id;
                    room.users[0].isAdmin = true;
                    io.to(roomId).emit('users-update', room.users);
                    io.to(roomId).emit('notification', '👑 ادمین جدید انتخاب شد.');
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
    console.log(`🔑 پسورد ادمین: ${ADMIN_PASSWORD}`);
});