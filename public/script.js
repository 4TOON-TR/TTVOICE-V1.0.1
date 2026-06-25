const socket = io();
let roomId = null;
let userName = '';
let localStream = null;
let peerConnections = {};
let isMicOn = true;
let isSpeakerOn = true;
let roomUsers = [];
let isAdmin = false;
let adminPassword = '';

// ========== ورود ادمین ==========
function adminLogin() {
    const password = prompt('🔑 پسورد ادمین رو وارد کن:');
    if (password) {
        adminPassword = password;
        window.adminPassword = password;
        alert('✅ به عنوان ادمین وارد شدی!');
    }
}

// ========== ایجاد اتاق ==========
function createRoom() {
    userName = document.getElementById('userName').value.trim() || 'ناشناس';
    const roomName = document.getElementById('roomName').value.trim() || 'اتاق جدید';
    socket.emit('create-room', { roomName, userName });
}

// ========== ورود به اتاق ==========
function joinRoom() {
    userName = document.getElementById('userName').value.trim() || 'ناشناس';
    const roomIdInput = document.getElementById('roomIdInput').value.trim().toUpperCase();
    if (!roomIdInput) {
        alert('❌ لطفاً کد اتاق را وارد کن!');
        return;
    }
    socket.emit('join-room', { roomId: roomIdInput, userName });
}

// ========== رویدادهای Socket ==========
socket.on('room-created', (id) => {
    roomId = id;
    document.getElementById('room-title').textContent = `🏠 اتاق: ${id}`;
    document.getElementById('roomIdInput').value = id;
    switchToCallPage();
    startAudio();
});

socket.on('you-are-admin', () => {
    isAdmin = true;
    document.getElementById('admin-badge').style.display = 'inline';
    alert('👑 شما ادمین این اتاق هستید!');
});

socket.on('user-joined', (users) => {
    roomUsers = users;
    updateUsersList(users);
    
    // برای کاربر جدید Offer بفرست
    const newUser = users.find(u => u.id !== socket.id && !peerConnections[u.id]);
    if (newUser && localStream) {
        setTimeout(() => {
            createAndSendOffer(newUser.id);
        }, 1000);
    }
});

socket.on('users-update', (users) => {
    roomUsers = users;
    updateUsersList(users);
    document.getElementById('user-count').textContent = `👤 ${users.length} نفر`;
});

socket.on('user-left', (users) => {
    roomUsers = users;
    updateUsersList(users);
    document.getElementById('user-count').textContent = `👤 ${users.length} نفر`;
});

socket.on('chat-history', (messages) => {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    messages.forEach(msg => addChatMessage(msg));
});

socket.on('chat-message', (msg) => {
    addChatMessage(msg);
});

socket.on('message-deleted', (messageId) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) el.remove();
});

socket.on('chat-cleared', () => {
    document.getElementById('chat-messages').innerHTML = '';
});

socket.on('images-update', (images) => {
    const container = document.getElementById('images-container');
    container.innerHTML = '';
    images.forEach(img => addImage(img));
});

socket.on('new-image', (image) => {
    addImage(image);
});

socket.on('image-deleted', (imageId) => {
    const el = document.querySelector(`[data-img-id="${imageId}"]`);
    if (el) el.remove();
});

socket.on('signal', ({ from, data }) => {
    handleSignal(from, data);
});

socket.on('notification', (msg) => {
    showNotification(msg);
});

socket.on('announcement', (data) => {
    showAnnouncement(data);
});

socket.on('you-are-banned', (msg) => {
    alert('🚫 ' + msg);
    leaveRoom();
});

socket.on('error', (msg) => {
    alert('❌ ' + msg);
});

// ========== راه‌اندازی صدا ==========
async function startAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });
        console.log('🎤 میکروفن فعال شد');
        document.getElementById('mic-btn').classList.add('active');
    } catch (err) {
        console.error('❌ خطا در دسترسی به میکروفن:', err);
        alert('❌ به میکروفن دسترسی نداری! لطفاً اجازه بده.');
    }
}

// ========== مدیریت WebRTC ==========
function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.play().catch(e => console.log('Audio play error:', e));
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', {
                roomId: roomId,
                data: {
                    type: 'ice',
                    candidate: event.candidate
                }
            });
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected') {
            console.log('✅ WebRTC متصل شد!');
        } else if (pc.iceConnectionState === 'failed') {
            console.log('❌ WebRTC قطع شد!');
        }
    };

    return pc;
}

function handleSignal(from, data) {
    console.log('📡 سیگنال از:', from, 'نوع:', data.type);

    if (data.type === 'offer') {
        if (!peerConnections[from]) {
            peerConnections[from] = createPeerConnection(from);
        }
        const pc = peerConnections[from];
        
        pc.setRemoteDescription(new RTCSessionDescription(data.offer))
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => {
                socket.emit('signal', {
                    roomId: roomId,
                    data: {
                        type: 'answer',
                        answer: pc.localDescription
                    }
                });
            })
            .catch(err => console.error('❌ خطا در پاسخ به Offer:', err));

    } else if (data.type === 'answer') {
        if (peerConnections[from]) {
            peerConnections[from].setRemoteDescription(new RTCSessionDescription(data.answer))
                .catch(err => console.error('❌ خطا در تنظیم Answer:', err));
        }

    } else if (data.type === 'ice') {
        if (peerConnections[from]) {
            peerConnections[from].addIceCandidate(new RTCIceCandidate(data.candidate))
                .catch(err => console.error('❌ خطا در اضافه کردن ICE:', err));
        }
    }
}

function createAndSendOffer(targetId) {
    if (!localStream) {
        console.log('❌ استریم محلی آماده نیست!');
        return;
    }
    
    if (peerConnections[targetId]) {
        return;
    }

    const pc = createPeerConnection(targetId);
    peerConnections[targetId] = pc;

    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            socket.emit('signal', {
                roomId: roomId,
                data: {
                    type: 'offer',
                    offer: pc.localDescription
                }
            });
            console.log('📤 Offer فرستاده شد به:', targetId);
        })
        .catch(err => console.error('❌ خطا در ایجاد Offer:', err));
}

// ========== تغییر وضعیت میکروفن ==========
function toggleMic() {
    if (localStream) {
        isMicOn = !isMicOn;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isMicOn;
        });
        document.getElementById('mic-btn').textContent = isMicOn ? '🎤 میکروفن' : '🔇 بی‌صدا';
        document.getElementById('mic-btn').classList.toggle('active', isMicOn);
    }
}

function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    document.getElementById('speaker-btn').textContent = isSpeakerOn ? '🔊 اسپیکر' : '🔇 بی‌صدا';
    document.getElementById('speaker-btn').classList.toggle('active', isSpeakerOn);
}

// ========== ارسال پیام ==========
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;
    socket.emit('chat-message', { roomId, message });
    input.value = '';
}

function addChatMessage(msg) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.setAttribute('data-msg-id', msg.id);
    
    div.innerHTML = `
        <span class="sender">${escapeHtml(msg.user)}</span>
        <span class="text">${escapeHtml(msg.message)}</span>
        <span class="time">${msg.time || ''}</span>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function deleteMessage(messageId) {
    if (!isAdmin) return;
    socket.emit('admin-delete-message', {
        roomId,
        messageId,
        password: window.adminPassword || prompt('پسورد ادمین:')
    });
}

function clearChat() {
    if (!isAdmin) return;
    if (confirm('آیا از پاک کردن همه‌ی پیام‌ها مطمئنی؟')) {
        socket.emit('admin-clear-chat', {
            roomId,
            password: window.adminPassword || prompt('پسورد ادمین:')
        });
    }
}

function banUser(userId, userName) {
    if (!isAdmin) return;
    if (confirm(`آیا از بن کردن ${userName} مطمئنی؟`)) {
        socket.emit('admin-ban-user', {
            roomId,
            userId,
            password: window.adminPassword || prompt('پسورد ادمین:')
        });
    }
}

// ========== اشتراک عکس ==========
function shareImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        socket.emit('share-image', {
            roomId,
            imageData: e.target.result,
            fileName: file.name
        });
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function addImage(image) {
    const container = document.getElementById('images-container');
    const div = document.createElement('div');
    div.className = 'image-item';
    div.setAttribute('data-img-id', image.id);
    div.innerHTML = `
        <img src="${image.data}" alt="${image.fileName}">
        <div class="image-info">${escapeHtml(image.user)} ${image.time || ''}</div>
    `;
    container.appendChild(div);
}

function deleteImage(imageId) {
    if (!isAdmin) return;
    socket.emit('admin-delete-image', {
        roomId,
        imageId,
        password: window.adminPassword || prompt('پسورد ادمین:')
    });
}

// ========== اعلان‌ها ==========
function showNotification(msg) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'notification';
    div.textContent = '📢 ' + msg;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function showAnnouncement(data) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'announcement';
    div.textContent = `📢 ${data.text} (${data.time})`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ========== به‌روزرسانی لیست کاربران ==========
function updateUsersList(users) {
    const container = document.getElementById('users-list');
    container.innerHTML = '';
    users.forEach(user => {
        const span = document.createElement('span');
        span.className = 'user-badge' + (user.isAdmin ? ' admin' : '');
        span.innerHTML = user.isAdmin ? `👑 ${escapeHtml(user.name)}` : escapeHtml(user.name);
        
        if (isAdmin && user.id !== socket.id) {
            const banBtn = document.createElement('button');
            banBtn.className = 'ban-btn';
            banBtn.textContent = '🚫';
            banBtn.title = 'بن کردن کاربر';
            banBtn.onclick = () => banUser(user.id, user.name);
            span.appendChild(banBtn);
        }
        
        container.appendChild(span);
    });
}

// ========== خروج ==========
function leaveRoom() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    window.location.reload();
}

// ========== تغییر صفحه ==========
function switchToCallPage() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('call-page').style.display = 'block';
    document.getElementById('user-count').textContent = '👤 1 نفر';
}

// ========== توابع کمکی ==========
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

console.log('✅ TTVOICE RUN SHOD!');
console.log('✅ تو کد ها سرک نکش اسیر میشی');
console.log('✅ برو پی کارت');