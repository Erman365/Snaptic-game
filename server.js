import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// Game state
const players = new Map();
const blocks = new Map();

// Helper function to generate unique ID
function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

// Block types
const BLOCK_TYPES = {
    grass: { color: 0x4a7c59 },
    stone: { color: 0x808080 },
    wood: { color: 0x8b4513 },
    brick: { color: 0xb22222 },
    dirt: { color: 0x8b7355 }
};

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Create new player (will be updated with customization)
    const playerId = socket.id;
    players.set(playerId, {
        id: playerId,
        name: 'Player',
        position: { x: 0, y: 5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        headRotation: { x: 0, y: 0, z: 0 },
        color: 0x4a9eff,
        hat: 'none'
    });

    // Handle player customization
    socket.on('playerCustomization', (data) => {
        const player = players.get(playerId);
        if (player) {
            player.name = data.name || 'Player';
            player.color = data.color || 0x4a9eff;
            player.hat = data.hat || 'none';
            
            // Send updated game state
            socket.emit('gameState', {
                players: Array.from(players.values()).filter(p => p.id !== playerId).map(p => ({
                    ...p,
                    equippedItem: p.equippedItem || null
                })),
                blocks: Array.from(blocks.entries()).map(([key, value]) => ({ key, ...value }))
            });

            // Broadcast new player to others
            socket.broadcast.emit('playerJoined', {
                ...player,
                equippedItem: player.equippedItem || null
            });
        }
    });

    // Handle player movement
    socket.on('playerMove', (data) => {
        const player = players.get(playerId);
        if (player) {
            // Don't accept position updates from dead players
            if (player.health !== undefined && player.health <= 0) {
                return; // Reject movement updates from dead players
            }
            player.position = data.position;
            player.rotation = data.rotation;
            player.headRotation = data.headRotation || { x: 0, y: 0, z: 0 };
            socket.broadcast.emit('playerMoved', {
                id: playerId,
                ...data
            });
        }
    });

    // Handle chat messages
    socket.on('chatMessage', (message) => {
        const player = players.get(playerId);
        if (player && message.trim()) {
            const chatData = {
                id: playerId,
                name: player.name,
                username: player.name,
                message: message,
                timestamp: new Date().toLocaleTimeString()
            };
            io.emit('chatMessage', chatData);
        }
    });

    // Handle block placement
    socket.on('placeBlock', (data) => {
        const blockKey = `${data.x},${data.y},${data.z}`;
        if (!blocks.has(blockKey)) {
            blocks.set(blockKey, {
                x: data.x,
                y: data.y,
                z: data.z,
                type: data.type || 'dirt'
            });
            io.emit('blockPlaced', blocks.get(blockKey));
        }
    });

    // Handle block removal
    socket.on('removeBlock', (data) => {
        const blockKey = `${data.x},${data.y},${data.z}`;
        if (blocks.has(blockKey)) {
            blocks.delete(blockKey);
            io.emit('blockRemoved', data);
        }
    });
    
    // Handle block updates (door state, sign messages)
    socket.on('blockUpdate', (data) => {
        const blockKey = `${data.x},${data.y},${data.z}`;
        const block = blocks.get(blockKey);
        if (block) {
            if (data.type === 'door') {
                block.isOpen = data.isOpen || false;
            } else if (data.type === 'sign') {
                block.message = data.message || '';
            }
            // Broadcast update to all clients
            io.emit('blockUpdated', { key: blockKey, ...block });
        }
    });

    // Handle baseball bat hit - launch player and trigger ragdoll
    socket.on('playerBatHit', (data) => {
        const attacker = players.get(playerId);
        const target = players.get(data.targetId);
        
        if (attacker && target && attacker.id !== target.id) {
            // Broadcast bat hit to all clients (no damage, just ragdoll)
            // Include angular velocities if provided for synced ragdoll animation
            io.emit('playerBatHit', {
                targetId: target.id,
                attackerId: attacker.id,
                launchDirection: data.launchDirection,
                angularVelocities: data.angularVelocities || null
            });
        }
    });
    
    // Handle ragdoll angular velocities sync
    socket.on('playerRagdollAngularVelocities', (data) => {
        // Broadcast to all other clients for consistent ragdoll animation
        socket.broadcast.emit('playerRagdollAngularVelocities', {
            playerId: playerId,
            angularVelocities: data.angularVelocities
        });
    });
    
    // Handle ragdoll state (from fall or bat hit)
    socket.on('playerRagdoll', (data) => {
        const player = players.get(playerId);
        if (player) {
            // Broadcast ragdoll state to all clients
            io.emit('playerRagdoll', {
                playerId: player.id,
                reason: data.reason,
                fallDistance: data.fallDistance
            });
        }
    });
    
    // Handle player damage
    socket.on('playerDamage', (data) => {
        const attacker = players.get(playerId);
        const target = players.get(data.targetId);
        
        // Allow normal hits (attacker !== target) and explicit self-damage (for reset)
        if (attacker && target && (attacker.id !== target.id || data.allowSelf)) {
            // Initialize health if not set
            if (target.health === undefined) {
                target.health = 100;
            }
            
            // Apply damage
            target.health = Math.max(0, target.health - (data.damage || 25));
            
            // Broadcast damage event
            io.emit('playerDamaged', {
                playerId: target.id,
                attackerId: attacker.id,
                damage: data.damage || 25,
                health: target.health
            });
            
            // If player died, broadcast death event with synced cube data
            if (target.health <= 0) {
                // Generate cube data for sync
                const cubeData = [];
                for (let i = 0; i < 30; i++) {
                    // Better explosion spread - distribute cubes in a circle
                    const angle = (Math.PI * 2 * i) / 30;
                    const radius = 0.3 + Math.random() * 0.4;
                    const verticalAngle = (Math.random() - 0.3) * Math.PI * 0.4;
                    
                    cubeData.push({
                        size: 0.3 + Math.random() * 0.3, // Doubled size
                        offset: {
                            x: (Math.random() - 0.5) * 0.5,
                            y: Math.random() * 0.3,
                            z: (Math.random() - 0.5) * 0.5
                        },
                        velocity: {
                            x: Math.cos(angle) * radius * (6 + Math.random() * 4),
                            y: Math.sin(verticalAngle) * (5 + Math.random() * 5) + 3,
                            z: Math.sin(angle) * radius * (6 + Math.random() * 4)
                        }
                    });
                }
                
                io.emit('playerDied', {
                    playerId: target.id,
                    attackerId: attacker.id,
                    deathPosition: target.position,
                    cubeData: cubeData
                });
                // Reset health and position after 5 seconds
                setTimeout(() => {
                    target.health = 100;
                    target.position = { x: 0, y: 5, z: 0 };
                    io.emit('playerRespawned', {
                        playerId: target.id,
                        position: { x: 0, y: 5, z: 0 }
                    });
                }, 5000);
            }
            
            console.log(`${attacker.name} hit ${target.name} for ${data.damage || 25} damage. ${target.name} health: ${target.health}`);
        }
    });

    // Handle player healing
    socket.on('playerHeal', (data) => {
        const player = players.get(playerId);
        if (player) {
            // Initialize health if not set
            if (player.health === undefined) {
                player.health = 100;
            }
            
            // Apply healing (use the health value from client, but cap at max)
            player.health = Math.min(100, data.health || player.health);
            
            // Broadcast health update to all players
            io.emit('playerHealthUpdate', {
                playerId: player.id,
                health: player.health
            });
            
            console.log(`${player.name} healed to ${player.health} health`);
        }
    });

    // Handle player respawn
    socket.on('playerRespawned', (data) => {
        const player = players.get(playerId);
        if (player) {
            player.position = data.position;
            socket.broadcast.emit('playerRespawned', {
                playerId: playerId,
                position: data.position
            });
        }
    });

    // Handle player equipping item
    socket.on('playerEquipItem', (data) => {
        const player = players.get(playerId);
        if (player) {
            player.equippedItem = data.item;
            socket.broadcast.emit('playerEquippedItem', {
                playerId: playerId,
                item: data.item
            });
        }
    });

    // Handle player using an item that has a swing animation (sword, baseball bat)
    socket.on('playerUseItemSwing', (data) => {
        socket.broadcast.emit('playerUseItemSwing', {
            playerId: playerId,
            item: data.item
        });
    });

    // Handle player arm swing (for block placement/destruction)
    socket.on('playerSwingArm', () => {
        socket.broadcast.emit('playerSwungArm', {
            playerId: playerId
        });
    });

    // Handle typing indicator
    socket.on('playerTyping', (isTyping) => {
        socket.broadcast.emit('playerTyping', {
            playerId: playerId,
            isTyping: isTyping
        });
    });

    // Handle player disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        players.delete(playerId);
        socket.broadcast.emit('playerLeft', playerId);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


