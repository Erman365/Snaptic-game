import { io } from 'socket.io-client';

let botSocket = null;
let botPosition = { x: 0, y: 1, z: 0 };
let botRotation = { y: 0 };
let botVelocity = { x: 0, y: 0, z: 0 };
let moveDirection = 0; // 0-7 for 8 directions
let moveTimer = null;
let actionTimer = null;

export function startBot(serverUrl, onConnect = null) {
    if (botSocket) {
        console.log('Bot already connected');
        return;
    }
    
    console.log('Starting bot...');
    
    // Connect as guest
    botSocket = io(serverUrl);
    
    // Notify callback when connected
    if (onConnect) {
        botSocket.on('connect', () => {
            onConnect(botSocket);
        });
    }
    
    botSocket.on('connect', () => {
        console.log('Bot connected to server');
        
        // Authenticate as guest
        botSocket.emit('authenticate', {
            username: 'BotPlayer',
            password: '',
            isGuest: true
        });
    });
    
    botSocket.on('authResponse', (data) => {
        if (data.success) {
            console.log('Bot authenticated');
            
            // Send player customization
            botSocket.emit('playerCustomization', {
                color: 0x888888, // Gray color
                hat: 'none',
                cape: 'none',
                name: 'BotPlayer'
            });
            
            // Start bot behavior
            startBotBehavior();
        }
    });
    
    botSocket.on('disconnect', () => {
        console.log('Bot disconnected');
        stopBotBehavior();
        botSocket = null;
    });
    
    botSocket.on('connect_error', (error) => {
        console.error('Bot connection error:', error);
    });
}

export function stopBot() {
    if (botSocket) {
        stopBotBehavior();
        botSocket.disconnect();
        botSocket = null;
        console.log('Bot stopped');
    }
}

function startBotBehavior() {
    // Random movement pattern
    moveTimer = setInterval(() => {
        // Change direction randomly every 3-8 seconds
        moveDirection = Math.floor(Math.random() * 8);
        
        // Randomly decide to stop moving
        if (Math.random() < 0.2) {
            botVelocity.x = 0;
            botVelocity.z = 0;
        } else {
            // Set velocity based on direction
            const speed = 100; // Base speed
            const angle = (moveDirection / 8) * Math.PI * 2;
            botVelocity.x = Math.sin(angle) * speed;
            botVelocity.z = Math.cos(angle) * speed;
            botRotation.y = angle;
        }
        
        // Update position
        updateBotPosition();
    }, 3000 + Math.random() * 5000);
    
    // Random actions (place blocks, swing arm, etc.)
    actionTimer = setInterval(() => {
        if (Math.random() < 0.3) {
            // Sometimes swing arm
            botSocket.emit('playerSwingArm');
        }
        
        if (Math.random() < 0.1) {
            // Sometimes place a block
            const blockX = Math.round(botPosition.x);
            const blockY = Math.round(botPosition.y - 1);
            const blockZ = Math.round(botPosition.z);
            
            botSocket.emit('placeBlock', {
                x: blockX,
                y: blockY,
                z: blockZ,
                type: 'dirt'
            });
        }
    }, 2000 + Math.random() * 3000);
    
    // Send position updates (like a real player)
    const updateInterval = setInterval(() => {
        if (botSocket && botSocket.connected) {
            botSocket.emit('playerMove', {
                position: botPosition,
                rotation: {
                    x: 0,
                    y: botRotation.y,
                    z: 0
                },
                headRotation: {
                    x: 0,
                    y: 0,
                    z: 0
                },
                isSprinting: false
            });
        } else {
            clearInterval(updateInterval);
        }
    }, 100); // Update 10 times per second
}

function stopBotBehavior() {
    if (moveTimer) {
        clearInterval(moveTimer);
        moveTimer = null;
    }
    if (actionTimer) {
        clearInterval(actionTimer);
        actionTimer = null;
    }
}

function updateBotPosition() {
    // Simple movement simulation
    const delta = 0.1; // Simulated delta time
    
    botPosition.x += botVelocity.x * delta;
    botPosition.z += botVelocity.z * delta;
    
    // Keep bot on ground level (y = 1)
    botPosition.y = 1;
    
    // Keep bot within reasonable bounds
    if (botPosition.x > 50) botPosition.x = 50;
    if (botPosition.x < -50) botPosition.x = -50;
    if (botPosition.z > 50) botPosition.z = 50;
    if (botPosition.z < -50) botPosition.z = -50;
}

