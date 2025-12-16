import * as THREE from 'three';

// Game state
let scene, camera, renderer, controls;
let localPlayer = null;
let otherPlayers = new Map();
let socket = null;
let blocks = new Map();
let selectedBlockType = 'dirt';
let buildMode = 'build'; // 'build', 'delete', or null (nothing mode for items)
let moveState = { forward: false, backward: false, left: false, right: false, jump: false, sprint: false };
let velocity = new THREE.Vector3();
let canJump = false;
let prevTime = performance.now();
let playerName = 'Player';
let isRagdoll = false;
let ragdollTime = 0;
let lastGroundY = 0; // Track last ground Y position for fall detection
let playerColor = 0x4a9eff;
let playerHat = 'none';

// Inventory and combat system
let inventory = ['sword', 'cheeseburger', 'soda', 'baseballbat'];
let selectedInventoryIndex = 0;
let inventoryOpen = false;
let playerHealth = 100;
let maxHealth = 100;
let isSwinging = false;
let isUsingItem = false;
let itemUseTime = 0;

// Pixelation settings
const PIXELATION_FACTOR = 2; // Higher = smaller pixels, more pixels (reduced for less pixelation)
let pixelRenderTarget = null;
let pixelScene = null;
let pixelCamera = null;
let pixelMaterial = null;
let pixelQuad = null;

// Third-person camera settings
let cameraDistance = 8;
const minCameraDistance = 3;
const maxCameraDistance = 20;
const cameraHeight = 4;
let cameraAngle = 0;
let cameraPitch = 0.3;
let cameraLocked = false; // Camera lock state
let pauseMenuOpen = false; // Pause menu state (UI only, game continues running)
let masterVolume = 1.0; // Master volume (0.0 to 1.0)

// Block types with colors
const BLOCK_TYPES = {
    grass: { color: 0x4a7c59, name: 'Grass' },
    stone: { color: 0x808080, name: 'Stone' },
    wood: { color: 0x8b4513, name: 'Wood' },
    brick: { color: 0xb22222, name: 'Brick' },
    dirt: { color: 0x8b7355, name: 'Dirt' }
};

// Initialize game
// Preload death sound for instant playback
let deathSound = null;
let metalHitSound = null;
let ragdollSound = null;
function preloadDeathSound() {
    deathSound = new Audio('death-sound.mp3');
    deathSound.volume = 0.7;
    deathSound.preload = 'auto';
    deathSound.load();
}
function preloadMetalHitSound() {
    // Create a metal hitting sound using Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    metalHitSound = {
        play: function() {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        }
    };
}
function preloadRagdollSound() {
    ragdollSound = new Audio('ragdollsound.mp3');
    ragdollSound.volume = 0.7;
    ragdollSound.preload = 'auto';
    ragdollSound.load();
}

function init() {
    // Preload sounds immediately
    preloadDeathSound();
    preloadMetalHitSound();
    preloadRagdollSound();
    
    // Create scene - minimalist style matching video
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8e8e8); // Light grey background matching video
    scene.fog = new THREE.Fog(0xe8e8e8, 0, 500);

    // Create camera (third-person)
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Setup pixelation effect
    setupPixelation();

    // Add lighting - enhanced for glossy metallic look
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    // Main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Additional fill light for better metallic reflection
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-30, 50, -30);
    scene.add(fillLight);
    
    // Rim light for extra gloss
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, 20, -50);
    scene.add(rimLight);

    // Create ground - minimalist light grey style (matching video)
    const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xd3d3d3, // Light grey matching video style
        roughness: 0.8,
        metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    ground.userData.isGround = true;
    scene.add(ground);

    // Setup controls
    setupControls();
    setupChat();
    setupBuildingMenu();
    setupLoginScreen();
    setupPauseMenu();

    // Start animation loop (game will start after login)
    animate();
}

// Create stickman with smooth, rounded, glossy metallic style (matching video)
function createStickman(color = 0xffffff, hat = 'none') {
    const group = new THREE.Group();

    // Enhanced glossy metallic material (matching video style)
    const metalMaterial = new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.95,
        roughness: 0.1,
        envMapIntensity: 1.5
    });

    // Body (torso) - smooth capsule shape exactly like video (rounded cylinder with more segments)
    // Create body FIRST so we can make it the parent of head, arms, and legs
    const bodyRadius = 0.2;
    const bodyHeight = 0.7;
    const bodyCylinder = new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyHeight, 20);
    const body = new THREE.Mesh(bodyCylinder, metalMaterial);
    body.position.y = 0.65;
    body.castShadow = true;
    group.add(body);

    // Store body reference for animation
    group.userData.body = body;

    // Head - smooth sphere, slightly detached/levitating from body
    // Head is now a child of body, so position is relative to body center
    // Body center is at y=0.65, body height is 0.7, so top of body is at 0.65 + 0.35 = 1.0
    // Head should float just a bit above the body top
    // Body top is at bodyHeight/2 = 0.35 relative to body center
    // Head radius is 0.3, so head center should be at: body top (0.35) + small gap (0.05) + head radius (0.3) = 0.7
    // This puts head bottom at 0.7 - 0.3 = 0.4, which is 0.05 above body top (0.35)
    const headGeometry = new THREE.SphereGeometry(0.3, 24, 24);
    const head = new THREE.Mesh(headGeometry, metalMaterial.clone());
    head.position.y = bodyHeight / 2 + 0.13 + 0.3; // Top of body (0.35) + small gap (0.13) + head radius (0.3) = 0.78 (head floats above body)
    head.position.z = 0; // Keep head centered on torso (no forward offset)
    head.castShadow = true;
    body.add(head); // Add head as child of body

    // Store head reference for hat attachment
    group.userData.head = head;
    
    // Add hat if specified - will be attached via helper function
    if (hat && hat !== 'none') {
        // Hat will be attached after player is created
        group.userData.hatType = hat;
    }

    // Arms with joints (upper arm + forearm with elbow)
    // Arms pivot from shoulders and swing forward/backward
    const upperArmLength = 0.35;
    const forearmLength = 0.15; // Reduced further from 0.2 to prevent clipping through elbow
    const armRadius = 0.1; // Same as leg radius
    const shoulderHeight = 1.0; // Shoulder level (top of body)
    const shoulderWidth = 0.25; // Distance from center to shoulder
    
    // Left arm group (for proper hierarchy)
    // Arms are now children of body, so position is relative to body
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(shoulderWidth, shoulderHeight - 0.65, -0.05); // Relative to body, moved back slightly
    body.add(leftArmGroup); // Add as child of body
    
    // Right arm group (for proper hierarchy)
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(-shoulderWidth, shoulderHeight - 0.65, -0.05); // Relative to body, moved back slightly
    body.add(rightArmGroup); // Add as child of body
    
    // Rotate arm groups 180 degrees to fix orientation
    leftArmGroup.rotation.y = Math.PI;
    rightArmGroup.rotation.y = Math.PI;
    
    // Shoulder joints (balls at shoulder) - same diameter as arm
    const shoulderJointRadius = armRadius;
    const leftShoulderJoint = new THREE.Mesh(
        new THREE.SphereGeometry(shoulderJointRadius, 12, 12),
        metalMaterial
    );
    leftShoulderJoint.position.set(0, 0, 0); // At shoulder position
    leftArmGroup.add(leftShoulderJoint);
    
    const rightShoulderJoint = new THREE.Mesh(
        new THREE.SphereGeometry(shoulderJointRadius, 12, 12),
        metalMaterial
    );
    rightShoulderJoint.position.set(0, 0, 0); // At shoulder position
    rightArmGroup.add(rightShoulderJoint);
    
    // Left arm - upper arm (pivots from shoulder, swings forward/back)
    const leftUpperArm = new THREE.Mesh(
        new THREE.CylinderGeometry(armRadius, armRadius, upperArmLength, 16),
        metalMaterial
    );
    leftUpperArm.position.y = -upperArmLength/2; // Position relative to shoulder
    leftUpperArm.castShadow = true;
    leftArmGroup.add(leftUpperArm);
    
    // Left arm - forearm (child of upper arm, pivots at elbow)
    const leftForearm = new THREE.Mesh(
        new THREE.CylinderGeometry(armRadius, armRadius, forearmLength, 16),
        metalMaterial
    );
    // Forearm cylinder is centered, so position it so it connects at the elbow
    // Upper arm ends at y = -upperArmLength, so forearm should start there
    // Cylinder center needs to be at -upperArmLength + forearmLength/2 so top edge is at -upperArmLength
    leftForearm.position.y = -upperArmLength + forearmLength / 2; // Top edge at end of upper arm
    leftForearm.castShadow = true;
    leftUpperArm.add(leftForearm);
    
    // Hand joint (ball at hand) - same diameter as arm, positioned at end of forearm
    // The forearm cylinder extends from -forearmLength/2 to +forearmLength/2 in its local space
    // So the hand (bottom of forearm) is at y = +forearmLength/2
    const handJointRadius = armRadius;
    const leftHandJoint = new THREE.Mesh(
        new THREE.SphereGeometry(handJointRadius, 12, 12),
        metalMaterial.clone()
    );
    leftHandJoint.position.set(0, forearmLength / 2, 0); // At end of forearm cylinder (hand)
    leftHandJoint.castShadow = true;
    leftHandJoint.visible = true;
    leftHandJoint.renderOrder = 100; // Ensure it renders on top
    leftForearm.add(leftHandJoint);
    
    // Elbow joint (ball at elbow) - welded to forearm so it moves with it
    // The elbow is at the top of the forearm (y = -forearmLength/2 in forearm's local space, where it connects)
    const elbowJointRadius = armRadius;
    const leftElbowJoint = new THREE.Mesh(
        new THREE.SphereGeometry(elbowJointRadius, 12, 12),
        metalMaterial.clone()
    );
    leftElbowJoint.position.set(0, -forearmLength / 2, 0); // At top of forearm (connection point with upper arm)
    leftElbowJoint.castShadow = true;
    leftElbowJoint.visible = true;
    leftElbowJoint.renderOrder = 100; // Ensure it renders on top
    leftForearm.add(leftElbowJoint);
    
    // Right arm - upper arm (pivots from shoulder, swings forward/back)
    const rightUpperArm = new THREE.Mesh(
        new THREE.CylinderGeometry(armRadius, armRadius, upperArmLength, 16),
        metalMaterial
    );
    rightUpperArm.position.y = -upperArmLength/2; // Position relative to shoulder
    rightUpperArm.castShadow = true;
    rightArmGroup.add(rightUpperArm);
    
    // Right arm - forearm (child of upper arm, pivots at elbow)
    const rightForearm = new THREE.Mesh(
        new THREE.CylinderGeometry(armRadius, armRadius, forearmLength, 16),
        metalMaterial
    );
    // Forearm cylinder is centered, so position it so it connects at the elbow
    // Upper arm ends at y = -upperArmLength, so forearm should start there
    // Cylinder center needs to be at -upperArmLength + forearmLength/2 so top edge is at -upperArmLength
    rightForearm.position.y = -upperArmLength + forearmLength / 2; // Top edge at end of upper arm
    rightForearm.castShadow = true;
    rightUpperArm.add(rightForearm);
    
    // Hand joint (ball at hand) - same diameter as arm, positioned at end of forearm
    // The forearm cylinder extends from -forearmLength/2 to +forearmLength/2 in its local space
    // So the hand (bottom of forearm) is at y = +forearmLength/2
    const rightHandJoint = new THREE.Mesh(
        new THREE.SphereGeometry(handJointRadius, 12, 12),
        metalMaterial.clone()
    );
    rightHandJoint.position.set(0, forearmLength / 2, 0); // At end of forearm cylinder (hand)
    rightHandJoint.castShadow = true;
    rightHandJoint.visible = true;
    rightHandJoint.renderOrder = 100; // Ensure it renders on top
    rightForearm.add(rightHandJoint);
    
    // Elbow joint (ball at elbow) - welded to forearm so it moves with it
    // The elbow is at the top of the forearm (y = -forearmLength/2 in forearm's local space, where it connects)
    const rightElbowJoint = new THREE.Mesh(
        new THREE.SphereGeometry(elbowJointRadius, 12, 12),
        metalMaterial.clone()
    );
    rightElbowJoint.position.set(0, -forearmLength / 2, 0); // At top of forearm (connection point with upper arm)
    rightElbowJoint.castShadow = true;
    rightElbowJoint.visible = true;
    rightElbowJoint.renderOrder = 100; // Ensure it renders on top
    rightForearm.add(rightElbowJoint);

    // Legs with joints (thigh + shin with knee)
    // Legs pivot from hips and swing forward/backward
    const thighLength = 0.4;
    const shinLength = 0.2; // Reduced further from 0.25 to prevent clipping through knee
    const legRadius = 0.1;
    const hipHeight = 0.5; // Hip level (adjusted so feet touch ground when player center is at 0.9)
    const hipWidth = 0.15; // Distance from center to hip
    
    // Left leg group (for proper hierarchy)
    // Legs are now children of body, so position is relative to body
    const leftLegGroup = new THREE.Group();
    // Position at hip level relative to body (body center is at 0.65, so hip should be around 0.5)
    leftLegGroup.position.set(-hipWidth, hipHeight - 0.65, 0.05); // Relative to body, moved forward slightly
    body.add(leftLegGroup); // Add as child of body
    
    // Left leg - thigh (pivots from hip, swings forward/back)
    const leftThigh = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius, legRadius, thighLength, 16),
        metalMaterial
    );
    leftThigh.position.y = -thighLength/2; // Position relative to hip (top of leg at torso bottom)
    leftThigh.castShadow = true;
    leftLegGroup.add(leftThigh);
    
    // Left leg - shin (child of thigh, pivots at knee)
    const leftShin = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius, legRadius, shinLength, 16),
        metalMaterial
    );
    // Shin cylinder is centered, so position it so it connects at the knee
    // Thigh ends at y = -thighLength, so shin should start there
    // Cylinder center needs to be at -thighLength + shinLength/2 so top edge is at -thighLength
    leftShin.position.y = -thighLength + shinLength / 2; // Top edge at end of thigh
    leftShin.castShadow = true;
    leftThigh.add(leftShin);
    
    // Foot joint (ball at foot) - same diameter as leg, positioned at end of shin
    // The shin cylinder extends from -shinLength/2 to +shinLength/2 in its local space
    // So the foot (bottom of shin) is at y = +shinLength/2
    const footJointRadius = legRadius;
    const leftFootJoint = new THREE.Mesh(
        new THREE.SphereGeometry(footJointRadius, 12, 12),
        metalMaterial.clone()
    );
    leftFootJoint.position.set(0, shinLength / 2, 0); // At end of shin cylinder (foot)
    leftFootJoint.castShadow = true;
    leftFootJoint.visible = true;
    leftFootJoint.renderOrder = 100; // Ensure it renders on top
    leftShin.add(leftFootJoint);
    
    // Knee joint (ball at knee) - welded to shin so it moves with it
    // The knee is at the top of the shin (y = -shinLength/2 in shin's local space, where it connects)
    const kneeJointRadius = legRadius;
    const leftKneeJoint = new THREE.Mesh(
        new THREE.SphereGeometry(kneeJointRadius, 12, 12),
        metalMaterial.clone()
    );
    leftKneeJoint.position.set(0, -shinLength / 2, 0); // At top of shin (connection point with thigh)
    leftKneeJoint.castShadow = true;
    leftKneeJoint.visible = true;
    leftKneeJoint.renderOrder = 100; // Ensure it renders on top
    leftShin.add(leftKneeJoint);
    
    // Right leg group (for proper hierarchy)
    // Legs are now children of body, so position is relative to body
    const rightLegGroup = new THREE.Group();
    // Position at hip level relative to body (body center is at 0.65, so hip should be around 0.5)
    rightLegGroup.position.set(hipWidth, hipHeight - 0.65, 0.05); // Relative to body, moved forward slightly
    body.add(rightLegGroup); // Add as child of body
    
    // Right leg - thigh (pivots from hip, swings forward/back)
    const rightThigh = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius, legRadius, thighLength, 16),
        metalMaterial
    );
    rightThigh.position.y = -thighLength/2; // Position relative to hip (top of leg at torso bottom)
    rightThigh.castShadow = true;
    rightLegGroup.add(rightThigh);
    
    // Right leg - shin (child of thigh, pivots at knee)
    const rightShin = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius, legRadius, shinLength, 16),
        metalMaterial
    );
    // Shin cylinder is centered, so position it so it connects at the knee
    // Thigh ends at y = -thighLength, so shin should start there
    // Cylinder center needs to be at -thighLength + shinLength/2 so top edge is at -thighLength
    rightShin.position.y = -thighLength + shinLength / 2; // Top edge at end of thigh
    rightShin.castShadow = true;
    rightThigh.add(rightShin);
    
    // Foot joint (ball at foot) - same diameter as leg, positioned at end of shin
    // The shin cylinder extends from -shinLength/2 to +shinLength/2 in its local space
    // So the foot (bottom of shin) is at y = +shinLength/2
    const rightFootJoint = new THREE.Mesh(
        new THREE.SphereGeometry(footJointRadius, 12, 12),
        metalMaterial.clone()
    );
    rightFootJoint.position.set(0, shinLength / 2, 0); // At end of shin cylinder (foot)
    rightFootJoint.castShadow = true;
    rightFootJoint.visible = true;
    rightFootJoint.renderOrder = 100; // Ensure it renders on top
    rightShin.add(rightFootJoint);
    
    // Knee joint (ball at knee) - welded to shin so it moves with it
    // The knee is at the top of the shin (y = -shinLength/2 in shin's local space, where it connects)
    const rightKneeJoint = new THREE.Mesh(
        new THREE.SphereGeometry(kneeJointRadius, 12, 12),
        metalMaterial.clone()
    );
    rightKneeJoint.position.set(0, -shinLength / 2, 0); // At top of shin (connection point with thigh)
    rightKneeJoint.castShadow = true;
    rightKneeJoint.visible = true;
    rightKneeJoint.renderOrder = 100; // Ensure it renders on top
    rightShin.add(rightKneeJoint);

    // Store references for animation and UI
    group.userData.head = head;
    group.userData.leftArmGroup = leftArmGroup;
    group.userData.leftUpperArm = leftUpperArm;
    group.userData.leftForearm = leftForearm;
    group.userData.rightArmGroup = rightArmGroup;
    group.userData.rightUpperArm = rightUpperArm;
    group.userData.rightForearm = rightForearm;
    group.userData.rightHandJoint = rightHandJoint; // Store hand joint for item attachment
    
    // Verify hand joint is correctly stored (debug)
    console.log('Hand joint stored:', {
        handJoint: rightHandJoint,
        parent: rightHandJoint.parent,
        position: rightHandJoint.position,
        isChildOfForearm: rightForearm.children.includes(rightHandJoint)
    });
    group.userData.leftLegGroup = leftLegGroup;
    group.userData.leftThigh = leftThigh;
    group.userData.leftShin = leftShin;
    group.userData.rightLegGroup = rightLegGroup;
    group.userData.rightThigh = rightThigh;
    group.userData.rightShin = rightShin;
    // Keep old references for backward compatibility
    group.userData.leftArm = leftArmGroup;
    group.userData.rightArm = rightArmGroup;
    group.userData.leftLeg = leftLegGroup;
    group.userData.rightLeg = rightLegGroup;
    group.userData.speechBubble = null;
    group.userData.nameLabel = null;
    group.userData.animationTime = 0;

    return group;
}

// Helper function to attach hat to head at fixed point
function attachHatToHead(player, hatMesh) {
    if (!player || !hatMesh) {
        return;
    }
    
    const head = player.userData.head;
    if (!head) {
        console.error('Missing head for hat attachment!');
        return;
    }
    
    // Attach hat to head - position lower on head (y = 0.2 in head's local space)
    hatMesh.castShadow = true;
    hatMesh.position.set(0, 0.2, 0); // Lower on head
    head.add(hatMesh);
    player.userData.hat = hatMesh;
    
    // Ensure hat is visible
    hatMesh.visible = true;
    if (hatMesh.children && hatMesh.children.length > 0) {
        hatMesh.children.forEach(child => {
            child.visible = true;
            child.castShadow = true;
            if (child.children && child.children.length > 0) {
                child.children.forEach(grandchild => {
                    grandchild.visible = true;
                    grandchild.castShadow = true;
                });
            }
        });
    }
}

// Create hat mesh - separate models for each hat type
function createHat(hatType, baseMaterial) {
    const hatGroup = new THREE.Group();
    
    // Create non-metallic material for hats with different colors
    const createHatMaterial = (color) => {
        return new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.0, // Non-metallic
            roughness: 0.8, // Rough/matte finish
            envMapIntensity: 0.0 // No reflections
        });
    };
    
    switch(hatType) {
        case 'cap':
            // Baseball cap - blue cap with darker blue brim
            // Brim (horizontal disk using RingGeometry)
            const capBrim = new THREE.RingGeometry(0.25, 0.35, 16);
            const brim = new THREE.Mesh(capBrim, createHatMaterial(0x1a1a2e)); // Dark blue/black brim
            brim.rotation.x = -Math.PI / 2; // Rotate to make it horizontal (flat disk facing up)
            brim.position.y = 0.05; // Just above head surface
            hatGroup.add(brim);
            // Cap crown - rounded top
            const capTop = new THREE.SphereGeometry(0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            const top = new THREE.Mesh(capTop, createHatMaterial(0x4a9eff)); // Blue cap
            top.position.y = 0.13; // Above brim
            hatGroup.add(top);
            break;
        case 'tophat':
            // Top hat - black with ribbon
            // Brim first (sits on head) - horizontal disk using RingGeometry
            const hatBrim = new THREE.RingGeometry(0.24, 0.35, 16);
            const hatBrimMesh = new THREE.Mesh(hatBrim, createHatMaterial(0x1a1a1a)); // Black
            hatBrimMesh.rotation.x = -Math.PI / 2; // Rotate to make it horizontal (flat disk facing up)
            hatBrimMesh.position.y = 0; // At head surface
            hatGroup.add(hatBrimMesh);
            // Main cylinder (taller)
            const hatCylinder = new THREE.CylinderGeometry(0.24, 0.24, 0.35, 16);
            const cylinder = new THREE.Mesh(hatCylinder, createHatMaterial(0x1a1a1a)); // Black
            cylinder.position.y = 0.175; // Half of cylinder height above brim
            hatGroup.add(cylinder);
            // Ribbon band (in middle of cylinder)
            const ribbon = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16);
            const ribbonMesh = new THREE.Mesh(ribbon, createHatMaterial(0x8b4513)); // Brown ribbon
            ribbonMesh.position.y = 0.175; // Middle of cylinder
            hatGroup.add(ribbonMesh);
            break;
        case 'crown':
            // Cheese hat - big triangular piece of cheese with holes
            // Create triangular cheese slice using ExtrudeGeometry
            const cheeseShape = new THREE.Shape();
            cheeseShape.moveTo(0, 0);
            cheeseShape.lineTo(-0.3, 0.25);
            cheeseShape.lineTo(0.3, 0.25);
            cheeseShape.lineTo(0, 0);
            
            const extrudeSettings = {
                depth: 0.15,
                bevelEnabled: false
            };
            const cheeseGeometry = new THREE.ExtrudeGeometry(cheeseShape, extrudeSettings);
            const cheeseMesh = new THREE.Mesh(cheeseGeometry, createHatMaterial(0xffd700)); // Yellow/cheese color
            cheeseMesh.rotation.x = -Math.PI / 2; // Rotate to sit on head
            cheeseMesh.position.y = 0.1; // On head
            hatGroup.add(cheeseMesh);
            
            // Add holes (Swiss cheese style) - create multiple holes
            const holePositions = [
                { x: -0.1, z: 0.1 },
                { x: 0.1, z: 0.08 },
                { x: 0, z: 0.15 },
                { x: -0.15, z: 0.15 },
                { x: 0.12, z: 0.18 }
            ];
            
            for (const holePos of holePositions) {
                const hole = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8);
                const holeMesh = new THREE.Mesh(hole, createHatMaterial(0x1a1a1a)); // Black for holes (or use scene background)
                holeMesh.rotation.x = Math.PI / 2; // Horizontal hole
                holeMesh.position.set(holePos.x, 0.1, holePos.z);
                // Make holes slightly transparent or use a darker color
                holeMesh.material.transparent = true;
                holeMesh.material.opacity = 0.3;
                hatGroup.add(holeMesh);
            }
            break;
        case 'helmet':
            // Helmet - silver/gray
            const helmetGeometry = new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 1.5);
            const helmet = new THREE.Mesh(helmetGeometry, createHatMaterial(0x808080)); // Gray
            helmet.position.y = 0.15; // Covers top of head
            hatGroup.add(helmet);
            // Visor
            const visor = new THREE.BoxGeometry(0.4, 0.05, 0.15);
            const visorMesh = new THREE.Mesh(visor, createHatMaterial(0x606060)); // Darker gray
            visorMesh.position.set(0, 0.1, 0.1);
            hatGroup.add(visorMesh);
            break;
        case 'cowboy':
            // Cowboy hat - brown with darker brown band
            // Brim first (sits on head) - horizontal disk using RingGeometry
            const cowboyBrim = new THREE.RingGeometry(0.24, 0.4, 16);
            const cowboyBrimMesh = new THREE.Mesh(cowboyBrim, createHatMaterial(0x8b4513)); // Brown
            cowboyBrimMesh.rotation.x = -Math.PI / 2; // Rotate to make it horizontal (flat disk facing up)
            cowboyBrimMesh.position.y = 0; // At head surface
            hatGroup.add(cowboyBrimMesh);
            // Top (crown)
            const cowboyTop = new THREE.CylinderGeometry(0.2, 0.24, 0.12, 16);
            const cowboyTopMesh = new THREE.Mesh(cowboyTop, createHatMaterial(0x8b4513)); // Brown
            cowboyTopMesh.position.y = 0.06; // Above brim
            hatGroup.add(cowboyTopMesh);
            // Band
            const band = new THREE.CylinderGeometry(0.21, 0.21, 0.03, 16);
            const bandMesh = new THREE.Mesh(band, createHatMaterial(0x654321)); // Dark brown
            bandMesh.position.y = 0.06; // On crown
            hatGroup.add(bandMesh);
            break;
    }
    
    return hatGroup;
}

// Create block
function createBlock(x, y, z, type = 'dirt') {
    const blockInfo = BLOCK_TYPES[type] || BLOCK_TYPES.dirt;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ 
        color: blockInfo.color,
        metalness: 0.3,
        roughness: 0.7
    });
    const block = new THREE.Mesh(geometry, material);
    // Blocks are positioned so their bottom is at the integer coordinate
    // Since block is 1 unit tall, center is at y + 0.5
    block.position.set(x, y + 0.5, z);
    block.castShadow = true;
    block.receiveShadow = true;
    block.userData.type = type;
    block.userData.gridY = y; // Store original grid Y for collision
    return block;
}

// Setup controls
function setupControls() {
    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        // Don't process game controls if user is typing in chat or name input
        const chatInput = document.getElementById('chat-input');
        const nameInput = document.getElementById('player-name');
        if ((chatInput && chatInput === document.activeElement) || 
            (nameInput && nameInput === document.activeElement)) {
            return; // Let the input handle the key
        }
        
        switch(e.code) {
            case 'KeyW':
            case 'ArrowUp':
                moveState.forward = true;
                break;
            case 'KeyS':
            case 'ArrowDown':
                moveState.backward = true;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                moveState.left = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                moveState.right = true;
                break;
            case 'Space':
                if (canJump) {
                    velocity.y += 7.5; // Reduced jump by half
                    canJump = false;
                    jumpAnimation(localPlayer);
                }
                e.preventDefault();
                break;
            case 'KeyQ':
                // Don't process if typing in chat or name input
                if (document.activeElement && (document.activeElement.id === 'chat-input' || document.activeElement.id === 'name-input')) {
                    return;
                }
                e.preventDefault(); // Always prevent default for Q
                
                if (inventoryOpen) {
                    // INVENTORY IS OPEN: Only cycle items, NEVER cycle build modes
                    selectedInventoryIndex = (selectedInventoryIndex - 1 + inventory.length) % inventory.length;
                    // Update equipped item immediately if in item mode (for preview)
                    // Always update the UI to show the selected item
                    if (buildMode === null && localPlayer && inventory[selectedInventoryIndex]) {
                        const selectedItem = inventory[selectedInventoryIndex];
                        localPlayer.userData.equippedItem = selectedItem;
                        createItemInHand(localPlayer, selectedItem);
                        if (socket) {
                            socket.emit('playerEquipItem', { item: selectedItem });
                        }
                    }
                    updateInventoryUI();
                    return; // Exit early to prevent any other processing
                } else {
                    // INVENTORY IS CLOSED: Cycle between build, delete, and nothing modes
                    const previousMode = buildMode;
                    if (buildMode === 'build') {
                        buildMode = 'delete';
                    } else if (buildMode === 'delete') {
                        buildMode = null; // Nothing mode - for using items (but don't auto-equip)
                    } else if (buildMode === null) {
                        buildMode = 'build';
                    } else {
                        // Fallback: if buildMode is something unexpected, reset to build
                        buildMode = 'build';
                    }
                    // DON'T auto-equip item when switching to item mode - items should only be equipped from inventory
                    // If switching from item mode to build/delete, remove item from hand
                    if (previousMode === null && buildMode !== null && localPlayer) {
                        removeItemFromHand(localPlayer);
                        localPlayer.userData.equippedItem = null;
                        if (socket) {
                            socket.emit('playerEquipItem', { item: null });
                        }
                    }
                    updateBuildModeUI();
                }
                break;
            case 'KeyE':
                // Don't process if typing in chat or name input
                if (document.activeElement && (document.activeElement.id === 'chat-input' || document.activeElement.id === 'name-input')) {
                    return;
                }
                
                if (inventoryOpen) {
                    // INVENTORY IS OPEN: Only cycle items, NEVER cycle build modes
                    e.preventDefault();
                    selectedInventoryIndex = (selectedInventoryIndex + 1) % inventory.length;
                    // Update equipped item immediately if in item mode (for preview)
                    // Always update the UI to show the selected item
                    if (buildMode === null && localPlayer && inventory[selectedInventoryIndex]) {
                        const selectedItem = inventory[selectedInventoryIndex];
                        localPlayer.userData.equippedItem = selectedItem;
                        createItemInHand(localPlayer, selectedItem);
                        if (socket) {
                            socket.emit('playerEquipItem', { item: selectedItem });
                        }
                    }
                    updateInventoryUI();
                    return; // Exit early to prevent any other processing
                }
                // E key does nothing outside inventory (only cycles items in inventory)
                break;
            case 'KeyF':
                // Don't process if typing in chat or name input
                if (document.activeElement && (document.activeElement.id === 'chat-input' || document.activeElement.id === 'name-input')) {
                    return;
                }
                // Toggle inventory
                inventoryOpen = !inventoryOpen;
                if (inventoryOpen) {
                    // Don't change buildMode when opening inventory - preserve current mode
                } else {
                    // When closing inventory, equip item if in item mode
                    if (buildMode === null && localPlayer && inventory[selectedInventoryIndex]) {
                        const selectedItem = inventory[selectedInventoryIndex];
                        localPlayer.userData.equippedItem = selectedItem;
                        createItemInHand(localPlayer, selectedItem);
                        if (socket) {
                            socket.emit('playerEquipItem', { item: selectedItem });
                        }
                    }
                }
                updateInventoryUI();
                e.preventDefault();
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                moveState.sprint = true;
                break;
            case 'ControlLeft':
            case 'ControlRight':
                // Toggle camera lock with pointer lock (like Roblox)
                if (!pauseMenuOpen) { // Don't allow camera lock when pause menu is open
                    const canvas = getCanvas();
                    if (canvas) {
                        if (!cameraLocked) {
                            // Enable camera lock and request pointer lock (cursor gets locked to center)
                            cameraLocked = true;
                            canvas.requestPointerLock().catch(() => {
                                console.log('Pointer lock failed');
                                cameraLocked = false;
                            });
                        } else {
                            // Disable camera lock and exit pointer lock
                            cameraLocked = false;
                            document.exitPointerLock();
                        }
                    }
                }
                e.preventDefault();
                break;
            case 'Escape':
                // Toggle pause menu
                togglePauseMenu();
                e.preventDefault();
                break;
        }
    });

    document.addEventListener('keyup', (e) => {
        switch(e.code) {
            case 'KeyW':
            case 'ArrowUp':
                moveState.forward = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                moveState.backward = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                moveState.left = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                moveState.right = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                moveState.sprint = false;
                break;
            case 'ControlLeft':
            case 'ControlRight':
                // Don't unlock on keyup - let pointer lock handle it
                break;
        }
    });

    // Mouse controls for camera
    let lastMouseX = 0;
    let lastMouseY = 0;
    let isMouseDown = false;
    
    // Get canvas element
    const getCanvas = () => document.getElementById('game-canvas');
    
    // Track mouse position for camera lock (without pointer lock, cursor stays visible)
    let lockedMouseX = 0;
    let lockedMouseY = 0;
    
    // Pointer lock change event
    document.addEventListener('pointerlockchange', () => {
        const canvas = getCanvas();
        if (canvas && document.pointerLockElement === canvas) {
            // Pointer is locked
            cameraLocked = true;
        } else {
            // Pointer is unlocked
            cameraLocked = false;
        }
    });
    
    // Pointer lock error handling
    document.addEventListener('pointerlockerror', () => {
        console.log('Pointer lock failed');
        cameraLocked = false;
    });
    
    // Mouse movement - track continuously when camera is locked
    document.addEventListener('mousemove', (e) => {
        if (cameraLocked) {
            // When locked, use movementX/Y from pointer lock (cursor is locked to center)
            const deltaX = e.movementX || 0;
            const deltaY = e.movementY || 0;
            cameraAngle -= deltaX * 0.002;
            cameraPitch += deltaY * 0.002;
            cameraPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraPitch));
        } else if (isMouseDown && e.target.id === 'game-canvas') {
            // Right-click drag camera (when not locked)
            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;
            cameraAngle -= deltaX * 0.002;
            cameraPitch += deltaY * 0.002;
            cameraPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraPitch));
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        }
    });
    
    document.addEventListener('mousedown', (e) => {
        if (e.target.id === 'game-canvas') {
            // Only handle camera movement on right click (when not locked)
            if (e.button === 2 && !cameraLocked) {
                isMouseDown = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                e.preventDefault(); // Prevent context menu
            }
        }
    });
    
    // Prevent context menu on canvas (already handled globally, but ensure it works)
    const canvas = getCanvas();
    if (canvas) {
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }

    document.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            isMouseDown = false;
        }
    });

    // Mouse wheel for camera zoom
    document.addEventListener('wheel', (e) => {
        if (e.target.id === 'game-canvas') {
            e.preventDefault();
            const zoomSpeed = 0.5;
            cameraDistance += e.deltaY * 0.01 * zoomSpeed;
            // Clamp camera distance to min/max values
            cameraDistance = Math.max(minCameraDistance, Math.min(maxCameraDistance, cameraDistance));
        }
    }, { passive: false });

    // Mouse click for building (no pointer lock required)
    document.addEventListener('mousedown', (e) => {
        // Only handle clicks on the canvas
        if (e.target.id !== 'game-canvas') return;
        
        // Get mouse position relative to canvas
        const rect = e.target.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        
        // Check intersections with blocks and ground
        const allObjects = Array.from(blocks.values());
        if (scene.children.find(c => c.userData.isGround)) {
            allObjects.push(scene.children.find(c => c.userData.isGround));
        }
        const intersects = raycaster.intersectObjects(allObjects, true);

        // Handle item usage or building/deleting based on mode (only left click)
        if (e.button === 0) {
            // If inventory is open, use item
            if (inventoryOpen) {
                useItem(localPlayer);
                return;
            }
            
            // If nothing mode and item equipped, use item
            if (buildMode === null && localPlayer && localPlayer.userData.equippedItem) {
                useItem(localPlayer);
                return;
            }
            
            if (intersects.length > 0) {
                if (buildMode === 'build') {
                    // Place block
                const intersect = intersects[0];
                    const normal = intersect.face.normal.clone(); // Clone to avoid modifying original
                    // Calculate placement position - add full block size (1.0) in normal direction
                    const newPos = intersect.point.clone().add(normal.multiplyScalar(1.0));
                    
                    // For side placement, ensure we get the correct grid position
                    // Round to nearest integer for all axes
                    let blockX = Math.round(newPos.x);
                    let blockY;
                    let blockZ = Math.round(newPos.z);
                    
                    // For Y, we need to account for block center offset
                    // If placing on top (normal.y > 0), place at next integer
                    // If placing on side/bottom, round normally
                    if (normal.y > 0.5) {
                        // Placing on top - get the grid Y of the block below and add 1
                        const blockBelow = intersect.object;
                        if (blockBelow.userData.gridY !== undefined) {
                            blockY = blockBelow.userData.gridY + 1;
                        } else {
                            blockY = Math.floor(intersect.point.y) + 1;
                        }
                    } else if (normal.y < -0.5) {
                        // Placing on bottom
                        blockY = Math.floor(newPos.y);
                    } else {
                        // Placing on side - use the block's grid position and offset by normal
                        const blockHit = intersect.object;
                        if (blockHit.userData.gridY !== undefined) {
                            // Get the grid position of the block we hit
                            const hitGridY = blockHit.userData.gridY;
                            const hitGridX = Math.round(blockHit.position.x);
                            const hitGridZ = Math.round(blockHit.position.z);
                            
                            // Calculate new position based on normal direction
                            blockX = hitGridX + Math.round(normal.x);
                            blockZ = hitGridZ + Math.round(normal.z);
                            blockY = hitGridY + Math.round(normal.y);
                        } else {
                            // Fallback to rounding
                            blockY = Math.round(newPos.y);
                        }
                    }
                
                const blockKey = `${blockX},${blockY},${blockZ}`;
                if (!blocks.has(blockKey)) {
                        swingArm(localPlayer);
                        // Notify other players of arm swing
                        if (socket) {
                            socket.emit('playerSwingArm');
                        }
                    placeBlock(blockX, blockY, blockZ, selectedBlockType);
                }
                } else if (buildMode === 'delete') {
                    // Remove block
                const intersect = intersects[0];
                const block = intersect.object;
                // Only remove if it's a block, not the ground
                if (block.userData.type) {
                        swingArm(localPlayer);
                        // Notify other players of arm swing
                        if (socket) {
                            socket.emit('playerSwingArm');
                        }
                    const pos = block.position;
                        const gridY = block.userData.gridY !== undefined ? block.userData.gridY : Math.round(pos.y - 0.5);
                        removeBlock(Math.round(pos.x), gridY, Math.round(pos.z));
                    }
                }
            }
        }
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        // Update pixelation render target
        if (pixelRenderTarget) {
            const pixelWidth = Math.floor(window.innerWidth / PIXELATION_FACTOR);
            const pixelHeight = Math.floor(window.innerHeight / PIXELATION_FACTOR);
            pixelRenderTarget.setSize(pixelWidth, pixelHeight);
        }
    });
}

// Setup pixelation effect
function setupPixelation() {
    const pixelWidth = Math.floor(window.innerWidth / PIXELATION_FACTOR);
    const pixelHeight = Math.floor(window.innerHeight / PIXELATION_FACTOR);
    
    // Create render target for low-res rendering
    pixelRenderTarget = new THREE.WebGLRenderTarget(pixelWidth, pixelHeight, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat
    });
    
    // Create scene and camera for displaying the pixelated texture
    pixelScene = new THREE.Scene();
    pixelCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    
    // Create fullscreen quad with the render target texture
    const geometry = new THREE.PlaneGeometry(2, 2);
    pixelMaterial = new THREE.MeshBasicMaterial({
        map: pixelRenderTarget.texture
    });
    pixelQuad = new THREE.Mesh(geometry, pixelMaterial);
    pixelScene.add(pixelQuad);
}

// Setup chat
function setupChat() {
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');

    let typingTimeout = null;
    let isTyping = false;

    chatInput.addEventListener('keydown', (e) => {
        // Stop event propagation so game controls don't interfere
        e.stopPropagation();
        
        if (e.key === 'Enter' && chatInput.value.trim()) {
            sendChatMessage(chatInput.value);
            chatInput.value = '';
            // Stop typing indicator
            if (socket && isTyping) {
                socket.emit('playerTyping', false);
                isTyping = false;
            }
            if (typingTimeout) {
                clearTimeout(typingTimeout);
                typingTimeout = null;
            }
        } else if (e.key !== 'Enter') {
            // Start typing indicator
            if (!isTyping && socket) {
                socket.emit('playerTyping', true);
                isTyping = true;
            }
            // Reset typing timeout
            if (typingTimeout) {
                clearTimeout(typingTimeout);
            }
            typingTimeout = setTimeout(() => {
                if (socket && isTyping) {
                    socket.emit('playerTyping', false);
                    isTyping = false;
                }
                typingTimeout = null;
            }, 1000); // Stop typing indicator after 1 second of no typing
        }
    });

    chatInput.addEventListener('blur', () => {
        // Stop typing indicator when chat loses focus
        if (socket && isTyping) {
            socket.emit('playerTyping', false);
            isTyping = false;
        }
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
    });
}

function sendChatMessage(message) {
    if (socket) {
        socket.emit('chatMessage', message);
    }
}

function displayChatMessage(data) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    messageDiv.innerHTML = `<span class="username">${data.username || data.name || 'Player'}:</span> ${data.message} <span class="timestamp">${data.timestamp}</span>`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Show speech bubble
    showSpeechBubble(data.id, data.message);
}

// Show typing indicator (three dots)
function showTypingIndicator(player) {
    // Remove existing typing indicator if any
    if (player.userData.typingBubble) {
        document.body.removeChild(player.userData.typingBubble);
    }

    const bubble = document.createElement('div');
    bubble.className = 'typing-bubble';
    bubble.textContent = '...';
    bubble.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        padding: 8px 12px;
        border-radius: 15px;
        font-size: 20px;
        pointer-events: none;
        z-index: 100;
        white-space: nowrap;
        font-family: Arial, sans-serif;
    `;
    document.body.appendChild(bubble);
    player.userData.typingBubble = bubble;
    updateTypingBubblePosition(player);
}

// Hide typing indicator
function hideTypingIndicator(player) {
    if (player.userData.typingBubble) {
        document.body.removeChild(player.userData.typingBubble);
        player.userData.typingBubble = null;
    }
}

// Update typing bubble position
function updateTypingBubblePosition(player) {
    if (!player.userData.typingBubble) return;

    const head = player.userData.head;
    if (!head) return;

    const headWorldPos = new THREE.Vector3();
    head.getWorldPosition(headWorldPos);
    headWorldPos.y += 0.5; // Position above head

    const screenPos = headWorldPos.project(camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

    player.userData.typingBubble.style.left = x + 'px';
    player.userData.typingBubble.style.top = (y - 40) + 'px';
}

function showSpeechBubble(playerId, message) {
    let player;
    if (playerId === socket?.id) {
        player = localPlayer;
    } else {
        player = otherPlayers.get(playerId);
    }

    if (!player) return;

    // Remove existing bubble
    if (player.userData.speechBubble) {
        document.body.removeChild(player.userData.speechBubble);
    }

    // Create new bubble
    const bubble = document.createElement('div');
    bubble.className = 'speech-bubble';
    bubble.textContent = message;
    player.userData.speechBubble = bubble;
    document.body.appendChild(bubble);

    // Update position
    updateSpeechBubblePosition(player);

    // Remove after 5 seconds
    setTimeout(() => {
        if (bubble.parentNode) {
            bubble.parentNode.removeChild(bubble);
        }
        if (player.userData.speechBubble === bubble) {
            player.userData.speechBubble = null;
        }
    }, 5000);
}

function updateSpeechBubblePosition(player) {
    if (!player.userData.speechBubble) return;

    const head = player.userData.head;
    const headWorldPos = new THREE.Vector3();
    head.getWorldPosition(headWorldPos);
    headWorldPos.y += 0.8;

    const vector = headWorldPos.project(camera);
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (vector.y * -0.5 + 0.5) * window.innerHeight;

    player.userData.speechBubble.style.left = x + 'px';
    player.userData.speechBubble.style.top = y + 'px';
}

// Create name label above player head
function createNameLabel(player) {
    const label = document.createElement('div');
    label.className = 'player-name-label';
    label.textContent = player.userData.name || 'Player';
    label.style.position = 'absolute';
    label.style.color = '#fff';
    label.style.fontSize = '14px';
    label.style.fontWeight = 'bold';
    label.style.textShadow = '2px 2px 4px rgba(0, 0, 0, 0.8)';
    label.style.pointerEvents = 'none';
    label.style.zIndex = '50';
    label.style.textAlign = 'center';
    label.style.whiteSpace = 'nowrap';
    document.body.appendChild(label);
    player.userData.nameLabel = label;
}

// Update name label position
function updateNameLabelPosition(player) {
    if (!player.userData.nameLabel) return;

    const head = player.userData.head;
    const headWorldPos = new THREE.Vector3();
    head.getWorldPosition(headWorldPos);
    // Position name label lower than speech bubble to avoid collision
    headWorldPos.y += 0.3; // Lower than speech bubble (which is at 0.8)

    const vector = headWorldPos.project(camera);
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (vector.y * -0.5 + 0.5) * window.innerHeight;

    player.userData.nameLabel.style.left = x + 'px';
    player.userData.nameLabel.style.top = y + 'px';
    player.userData.nameLabel.style.transform = 'translate(-50%, -100%)';
    
    // Hide name label if speech bubble is active
    if (player.userData.speechBubble) {
        player.userData.nameLabel.style.opacity = '0.5';
    } else {
        player.userData.nameLabel.style.opacity = '1';
    }
}

// Trigger ragdoll physics on player
function triggerRagdoll(player, launchVelocity, syncAngularVelocities = null) {
    if (!player) return;
    
    player.userData.isRagdoll = true;
    player.userData.ragdollTime = 0;
    player.userData.ragdollVelocity = launchVelocity.clone();
    
    // Store initial rotations for reset when ragdoll ends
    // Store initial rotations for reset after ragdoll
    player.userData.initialRotations = {
        root: { x: player.rotation.x, y: player.rotation.y, z: player.rotation.z },
        leftArm: { x: player.userData.leftArmGroup?.rotation.x || 0, z: player.userData.leftArmGroup?.rotation.z || 0 },
        rightArm: { x: player.userData.rightArmGroup?.rotation.x || 0, z: player.userData.rightArmGroup?.rotation.z || 0 },
        leftLeg: { x: player.userData.leftLegGroup?.rotation.x || 0, z: player.userData.leftLegGroup?.rotation.z || 0 },
        rightLeg: { x: player.userData.rightLegGroup?.rotation.x || 0, z: player.userData.rightLegGroup?.rotation.z || 0 },
        body: { 
            x: player.userData.body?.rotation.x || 0, 
            y: player.userData.body?.rotation.y || 0, 
            z: player.userData.body?.rotation.z || 0 
        },
        head: { 
            x: player.userData.head?.rotation.x || 0, 
            y: player.userData.head?.rotation.y || 0, 
            z: player.userData.head?.rotation.z || 0 
        }
    };
    
    // Initialize ragdoll state - use synced values if provided, otherwise generate random
    // Note: syncAngularVelocities is the old format, we need to convert it or use ragdollState
    if (syncAngularVelocities && syncAngularVelocities.torso) {
        // Convert old format to new ragdollState format
        player.userData.ragdollState = {
            torsoAngVel: syncAngularVelocities.torso,
            leftArmAngVel: syncAngularVelocities.leftArm || { x: 0, z: 0 },
            rightArmAngVel: syncAngularVelocities.rightArm || { x: 0, z: 0 },
            leftLegAngVel: syncAngularVelocities.leftLeg || { x: 0, z: 0 },
            rightLegAngVel: syncAngularVelocities.rightLeg || { x: 0, z: 0 },
            initialForceApplied: true,
            initialForceTime: 0
        };
        } else {
            // Generate initial angular velocities here (not in updateRagdoll) so we can sync them immediately
            // Check if this is from a fall (zero launch velocity) or a hit
            const vel = launchVelocity.length();
            const isFromFall = vel < 0.1; // Fall has zero or near-zero velocity
            
            // Generate consistent random values (use a seed based on time to make them consistent)
            // For falls, we'll sync them via playerRagdoll event
            const initialTorsoAngVel = isFromFall ? {
                // For falls, apply stronger initial rotation
                x: (Math.random() - 0.5) * 10,
                y: (Math.random() - 0.5) * 6,
                z: (Math.random() - 0.5) * 8
            } : {
                // For bat hits, angular velocities should come from syncAngularVelocities
                // If not provided, generate (but this shouldn't happen for bat hits)
                x: (Math.random() - 0.5) * 8,
                y: (Math.random() - 0.5) * 4,
                z: (Math.random() - 0.5) * 6
            };
            
            player.userData.ragdollState = {
                torsoAngVel: initialTorsoAngVel,
                leftArmAngVel: { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 },
                rightArmAngVel: { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 },
                leftLegAngVel: { x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 },
                rightLegAngVel: { x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 },
                initialForceApplied: true,
                initialForceTime: 0
            };
            
            // Sync ragdoll state to server immediately (for local player falling)
            // For bat hits, angular velocities are already synced via playerBatHit
            if (player === localPlayer && socket && isFromFall) {
                socket.emit('playerRagdollAngularVelocities', {
                    playerId: socket.id,
                    angularVelocities: {
                        torso: player.userData.ragdollState.torsoAngVel,
                        leftArm: player.userData.ragdollState.leftArmAngVel,
                        rightArm: player.userData.ragdollState.rightArmAngVel,
                        leftLeg: player.userData.ragdollState.leftLegAngVel,
                        rightLeg: player.userData.ragdollState.rightLegAngVel
                    }
                });
            }
        }
    
    // Apply initial launch velocity - 45 degree angle launch
    // 45 degrees means horizontal and vertical components are equal
    const launchSpeed = 12.0; // Launch speed
    const angle45 = Math.PI / 4; // 45 degrees
    
    if (player === localPlayer) {
        // Calculate 45 degree launch direction
        const horizontalDir = new THREE.Vector3(launchVelocity.x, 0, launchVelocity.z).normalize();
        const horizontalSpeed = launchSpeed * Math.cos(angle45); // Horizontal component at 45 degrees
        const verticalSpeed = launchSpeed * Math.sin(angle45); // Vertical component at 45 degrees
        
        velocity.x = horizontalDir.x * horizontalSpeed;
        velocity.y = verticalSpeed; // Always launch upward at 45 degrees
        velocity.z = horizontalDir.z * horizontalSpeed;
        isRagdoll = true;
        ragdollTime = 0;
    } else {
        // For other players, store launch velocity for continuous application
        const horizontalDir = new THREE.Vector3(launchVelocity.x, 0, launchVelocity.z).normalize();
        const horizontalSpeed = launchSpeed * Math.cos(angle45);
        const verticalSpeed = launchSpeed * Math.sin(angle45);
        
        player.userData.ragdollVelocity = new THREE.Vector3(
            horizontalDir.x * horizontalSpeed,
            verticalSpeed,
            horizontalDir.z * horizontalSpeed
        );
    }
    
    // Play ragdoll sound
    if (ragdollSound) {
        ragdollSound.play().catch(err => {
            console.log('Could not play ragdoll sound:', err);
        });
    }
}

// Check limb collision with blocks and other objects - returns hit info for physics
function checkLimbCollision(player, limbGroup, delta) {
    if (!player || !limbGroup || !player.userData.isRagdoll) return { hit: false };
    
    // Get world position of limb base (shoulder/hip)
    const limbBasePos = new THREE.Vector3();
    limbGroup.getWorldPosition(limbBasePos);
    
    // Estimate limb end position based on rotation and length
    const isArm = limbGroup === player.userData.leftArmGroup || limbGroup === player.userData.rightArmGroup;
    const limbLength = isArm ? 0.65 : 0.8;
    const limbRadius = 0.1;
    
    // Check multiple points along the limb
    const checkPoints = 3;
    let hitFound = false;
    let hitNormal = new THREE.Vector3();
    let hitPoint = new THREE.Vector3();
    
    for (let i = 0; i <= checkPoints; i++) {
        const t = i / checkPoints;
        const pointLocal = new THREE.Vector3(0, -limbLength * t, 0);
        pointLocal.applyQuaternion(limbGroup.quaternion);
        const pointWorld = limbBasePos.clone().add(pointLocal);
        
        // Check collision with blocks
        const blockHit = checkCollisionWithBlocks(player, pointWorld, limbRadius, true);
        if (blockHit && blockHit.hit) {
            hitFound = true;
            hitNormal.add(blockHit.normal);
            hitPoint.add(blockHit.point);
        }
    }
    
    if (hitFound) {
        hitNormal.normalize();
        hitPoint.multiplyScalar(1 / (checkPoints + 1));
        
        // Calculate angular impulse based on hit direction
        // Cross product of hit normal and limb direction gives rotation axis
        const limbDir = new THREE.Vector3(0, -1, 0).applyQuaternion(limbGroup.quaternion);
        const angularAxis = new THREE.Vector3().crossVectors(hitNormal, limbDir).normalize();
        
        // Apply angular impulse (fling the limb)
        const impulseStrength = 8.0;
        return {
            hit: true,
            angularImpulse: {
                x: angularAxis.x * impulseStrength,
                z: angularAxis.z * impulseStrength
            },
            normal: hitNormal,
            point: hitPoint
        };
    }
    
    return { hit: false };
}

// Check body part collision with blocks - returns hit info for physics
function checkBodyPartCollision(player, bodyPart, radius, offsetY, delta) {
    if (!player || !bodyPart || !player.userData.isRagdoll) return { hit: false };
    
    // Get world position of body part
    const bodyPartPos = new THREE.Vector3();
    bodyPart.getWorldPosition(bodyPartPos);
    bodyPartPos.y += offsetY;
    
    // Check collision with blocks
    const hit = checkCollisionWithBlocks(player, bodyPartPos, radius, true);
    
    if (hit && hit.hit) {
        // Calculate velocity change based on hit normal
        const bounceStrength = 2.0;
        return {
            hit: true,
            velocityChange: {
                x: hit.normal.x * bounceStrength,
                y: hit.normal.y * bounceStrength,
                z: hit.normal.z * bounceStrength
            },
            normal: hit.normal,
            point: hit.point
        };
    }
    
    return { hit: false };
}

// Generic collision check with blocks - returns hit info if returnHitInfo is true
function checkCollisionWithBlocks(player, worldPos, radius, returnHitInfo = false) {
    let hitResult = null;
    
    // Check collision with blocks
    for (const [key, block] of blocks.entries()) {
        const blockPos = block.position;
        const gridY = block.userData.gridY !== undefined ? block.userData.gridY : Math.round(blockPos.y - 0.5);
        const blockMin = new THREE.Vector3(blockPos.x - 0.5, gridY, blockPos.z - 0.5);
        const blockMax = new THREE.Vector3(blockPos.x + 0.5, gridY + 1, blockPos.z + 0.5);
        
        // Check if body part is inside block
        if (worldPos.x + radius > blockMin.x && worldPos.x - radius < blockMax.x &&
            worldPos.y + radius > blockMin.y && worldPos.y - radius < blockMax.y &&
            worldPos.z + radius > blockMin.z && worldPos.z - radius < blockMax.z) {
            
            // Calculate push direction (normal)
            const pushDir = new THREE.Vector3(
                worldPos.x - blockPos.x,
                worldPos.y - (gridY + 0.5),
                worldPos.z - blockPos.z
            );
            const distance = pushDir.length();
            
            if (distance > 0.001) {
                pushDir.normalize();
                const pushAmount = 0.05;
                
                // Push player away
                if (player === localPlayer) {
                    localPlayer.position.x += pushDir.x * pushAmount;
                    localPlayer.position.y += pushDir.y * pushAmount;
                    localPlayer.position.z += pushDir.z * pushAmount;
                } else {
                    player.position.x += pushDir.x * pushAmount;
                    player.position.y += pushDir.y * pushAmount;
                    player.position.z += pushDir.z * pushAmount;
                }
                
                // Return hit info if requested
                if (returnHitInfo) {
                    hitResult = {
                        hit: true,
                        normal: pushDir.clone(),
                        point: worldPos.clone()
                    };
                }
            }
        }
    }
    
    // Check collision with ground - smoother, less jitter
    const groundY = 0;
    if (worldPos.y - radius < groundY) {
        const penetration = (groundY - (worldPos.y - radius));
        // Smaller, smoother push to prevent jitter
        const pushAmount = Math.min(0.08, penetration * 0.5);
        
        if (player === localPlayer) {
            // Only push if significantly below ground to prevent constant jitter
            if (penetration > 0.05) {
                localPlayer.position.y += pushAmount;
            }
            // Dampen velocity more smoothly
            if (velocity.y < 0 && penetration > 0.05) {
                velocity.y *= 0.3;
            }
        } else {
            // Only push if significantly below ground to prevent constant jitter
            if (penetration > 0.05) {
                player.position.y += pushAmount;
            }
            // Dampen velocity more smoothly
            if (player.userData.ragdollVelocity && player.userData.ragdollVelocity.y < 0 && penetration > 0.05) {
                player.userData.ragdollVelocity.y *= 0.3;
            }
        }
        
        // Return hit info for ground
        if (returnHitInfo && !hitResult) {
            hitResult = {
                hit: true,
                normal: new THREE.Vector3(0, 1, 0), // Ground normal is up
                point: new THREE.Vector3(worldPos.x, groundY, worldPos.z)
            };
        }
    }
    
    return returnHitInfo ? (hitResult || { hit: false }) : null;
}

// Update ragdoll physics - completely rewritten from scratch
function updateRagdoll(player, delta) {
    if (!player.userData.isRagdoll) return;
    
    player.userData.ragdollTime += delta;
    const cappedDelta = Math.min(delta, 0.1);
    
    // Physics constants
    const torsoDamping = 0.99; // Torso rotation damping (natural decay)
    const limbDamping = 0.98; // Limb rotation damping
    const airResistance = 0.998; // Air resistance for velocity
    const gravityTorque = 6.0; // Gravity torque on torso (after initial force)
    const initialForceDuration = 0.1; // Duration for initial force only (0.1 seconds)
    
    // ragdollState should already be initialized in triggerRagdoll
    // If it's not, something went wrong - this should never happen
    if (!player.userData.ragdollState) {
        console.error('ragdollState not initialized! This should not happen.');
        // Don't initialize here - it should have been done in triggerRagdoll
        // Return early to prevent crashes
        return;
    }
    
    const state = player.userData.ragdollState;
    
    // Track initial force time
    if (state.initialForceApplied) {
        state.initialForceTime += cappedDelta;
    }
    
    // ===== TORSO PHYSICS =====
    // Torso rotates on all 3 axes - gets HUGE initial force, then affected by gravity and collisions
    // NO root rotation - only body rotates, not the root player group
    if (player.userData.body && state && state.torsoAngVel) {
        // Check if on ground
        const groundLevel = 0.27; // Ground level for ragdoll collision (lowered by 0.03 to fix floating)
        const isOnGround = (player === localPlayer) 
            ? (localPlayer.position.y <= groundLevel + 0.05 && velocity.y <= 0.1)
            : (player.position.y <= groundLevel + 0.05 && player.userData.ragdollVelocity && player.userData.ragdollVelocity.y <= 0.1);
        
        // Check if torso is horizontal (lying flat on ground)
        // Torso is horizontal when body rotation.x is close to 0 (flat on back) or close to Math.PI (flat on front)
        // Also check if rotation.x is close to Math.PI/2 or -Math.PI/2 (lying on side)
        const bodyRotX = player.userData.body.rotation.x;
        const isHorizontal = Math.abs(bodyRotX) < 0.3 || 
                            Math.abs(bodyRotX - Math.PI) < 0.3 || 
                            Math.abs(bodyRotX - Math.PI/2) < 0.3 || 
                            Math.abs(bodyRotX + Math.PI/2) < 0.3;
        
        // Initialize horizontal hit counter if not exists
        if (!state.horizontalHitCount) {
            state.horizontalHitCount = 0;
            state.wasHorizontalLastFrame = false;
        }
        
        // Track when torso becomes horizontal on ground (count transitions)
        if (isOnGround && isHorizontal && !state.wasHorizontalLastFrame) {
            // Just became horizontal on ground - increment counter
            state.horizontalHitCount++;
            state.wasHorizontalLastFrame = true;
        } else if (!isOnGround || !isHorizontal) {
            // Not horizontal anymore - reset flag
            state.wasHorizontalLastFrame = false;
        }
        
        // Stop rotation completely when horizontal for the third time (after first two hits)
        if (isOnGround && isHorizontal && state.horizontalHitCount >= 3) {
            // Third time horizontal on ground - lose all energy, stop all rotation
            state.torsoAngVel.x = 0;
            state.torsoAngVel.y = 0;
            state.torsoAngVel.z = 0;
        } else {
            // In air or not horizontal enough times - apply physics
            // After initial force period, apply gravity torque (like limbs)
            if (state.initialForceTime > initialForceDuration) {
                // Apply gravity torque based on body orientation (makes it fall naturally)
                if (Math.abs(bodyRotX) > 0.15) {
                    state.torsoAngVel.x += Math.sin(bodyRotX) * gravityTorque * cappedDelta;
                }
                // Apply some roll based on body orientation
                if (Math.abs(bodyRotX) > 0.2) {
                    state.torsoAngVel.z += Math.cos(bodyRotX) * gravityTorque * 0.3 * cappedDelta;
                }
            }
            
            // Apply rotation to BODY (torso) - since body is now parent of head, arms, and legs,
            // rotating the body will automatically rotate everything with it
            if (state.torsoAngVel.x !== undefined && state.torsoAngVel.y !== undefined && state.torsoAngVel.z !== undefined) {
                player.userData.body.rotation.x += state.torsoAngVel.x * cappedDelta;
                player.userData.body.rotation.y += state.torsoAngVel.y * cappedDelta;
                player.userData.body.rotation.z += state.torsoAngVel.z * cappedDelta;
            }
            
            // Dampen torso rotation (natural decay)
            state.torsoAngVel.x *= torsoDamping;
            state.torsoAngVel.y *= torsoDamping;
            state.torsoAngVel.z *= torsoDamping;
        }
    }
    
    // ===== HEAD STAYS WITH TORSO =====
    // Head is now a child of body, so it automatically rotates with body
    // Keep head rotation at 0 relative to body so it stays attached
    if (player.userData.head) {
        player.userData.head.rotation.x = 0;
        player.userData.head.rotation.y = 0;
        player.userData.head.rotation.z = 0;
    }
    
    // ===== LIMBS PHYSICS =====
    // Limbs ragdoll independently but joints stay attached to torso
    // They get initial angular velocity and can be affected by collisions
    
    // Left arm - ragdolls but joint stays on torso
    if (player.userData.leftArmGroup) {
        // Apply ragdoll rotation (joint stays attached, limb rotates)
        player.userData.leftArmGroup.rotation.x += state.leftArmAngVel.x * cappedDelta;
        player.userData.leftArmGroup.rotation.z += state.leftArmAngVel.z * cappedDelta;
        
        // Apply damping
        state.leftArmAngVel.x *= limbDamping;
        state.leftArmAngVel.z *= limbDamping;
        
        // Check collision - if hit, apply additional angular velocity
        const hitResult = checkLimbCollision(player, player.userData.leftArmGroup, cappedDelta);
        if (hitResult && hitResult.hit) {
            state.leftArmAngVel.x += hitResult.angularImpulse.x;
            state.leftArmAngVel.z += hitResult.angularImpulse.z;
        }
    }
    
    // Right arm - ragdolls but joint stays on torso
    if (player.userData.rightArmGroup) {
        player.userData.rightArmGroup.rotation.x += state.rightArmAngVel.x * cappedDelta;
        player.userData.rightArmGroup.rotation.z += state.rightArmAngVel.z * cappedDelta;
        state.rightArmAngVel.x *= limbDamping;
        state.rightArmAngVel.z *= limbDamping;
        
        const hitResult = checkLimbCollision(player, player.userData.rightArmGroup, cappedDelta);
        if (hitResult && hitResult.hit) {
            state.rightArmAngVel.x += hitResult.angularImpulse.x;
            state.rightArmAngVel.z += hitResult.angularImpulse.z;
        }
    }
    
    // Left leg - ragdolls but joint stays on torso
    if (player.userData.leftLegGroup) {
        player.userData.leftLegGroup.rotation.x += state.leftLegAngVel.x * cappedDelta;
        player.userData.leftLegGroup.rotation.z += state.leftLegAngVel.z * cappedDelta;
        state.leftLegAngVel.x *= limbDamping;
        state.leftLegAngVel.z *= limbDamping;
        
        const hitResult = checkLimbCollision(player, player.userData.leftLegGroup, cappedDelta);
        if (hitResult && hitResult.hit) {
            state.leftLegAngVel.x += hitResult.angularImpulse.x;
            state.leftLegAngVel.z += hitResult.angularImpulse.z;
        }
    }
    
    // Right leg - ragdolls but joint stays on torso
    if (player.userData.rightLegGroup) {
        player.userData.rightLegGroup.rotation.x += state.rightLegAngVel.x * cappedDelta;
        player.userData.rightLegGroup.rotation.z += state.rightLegAngVel.z * cappedDelta;
        state.rightLegAngVel.x *= limbDamping;
        state.rightLegAngVel.z *= limbDamping;
        
        const hitResult = checkLimbCollision(player, player.userData.rightLegGroup, cappedDelta);
        if (hitResult && hitResult.hit) {
            state.rightLegAngVel.x += hitResult.angularImpulse.x;
            state.rightLegAngVel.z += hitResult.angularImpulse.z;
        }
    }
    
    // ===== BODY COLLISION =====
    // Check torso/head collision - affects trajectory AND rotation
    if (player.userData.body) {
        const bodyHit = checkBodyPartCollision(player, player.userData.body, 0.2, 0.35, cappedDelta);
        if (bodyHit && bodyHit.hit) {
            if (player === localPlayer) {
                // Body hit affects trajectory
                velocity.x += bodyHit.velocityChange.x;
                velocity.y += bodyHit.velocityChange.y;
                velocity.z += bodyHit.velocityChange.z;
            }
            
            // Body hit also affects rotation (collision causes rotation)
            // Calculate angular impulse from collision normal
            const hitNormal = bodyHit.normal;
            const angularImpulseStrength = 3.0;
            
            // Apply angular velocity based on collision direction
            state.torsoAngVel.x += hitNormal.z * angularImpulseStrength;
            state.torsoAngVel.y += hitNormal.x * angularImpulseStrength;
            state.torsoAngVel.z += hitNormal.y * angularImpulseStrength;
        }
    }
    
    // ===== GROUND COLLISION DETECTION =====
    // Check if player is on ground (smooth detection, less jitter)
    const groundLevel = 0.3;
    const isOnGround = (player === localPlayer) 
        ? (localPlayer.position.y <= groundLevel + 0.05 && velocity.y <= 0.1)
        : (player.position.y <= groundLevel + 0.05 && player.userData.ragdollVelocity && player.userData.ragdollVelocity.y <= 0.1);
    
    // ===== POSITION/VELOCITY PHYSICS =====
    // For other players
    if (player !== localPlayer && player.userData.ragdollVelocity) {
        const vel = player.userData.ragdollVelocity;
        player.position.x += vel.x * cappedDelta;
        player.position.y += vel.y * cappedDelta;
        player.position.z += vel.z * cappedDelta;
        
        vel.y -= 30 * cappedDelta; // Gravity
        vel.x *= airResistance;
        vel.z *= airResistance;
        
        // Ground collision - smooth handling
        if (player.position.y < groundLevel) {
            const penetration = groundLevel - player.position.y;
            // Smooth push up (less aggressive to prevent jitter)
            player.position.y = groundLevel;
            
            if (vel.y < 0) {
                // Strong dampen on ground (friction)
                vel.y *= 0.1;
                vel.x *= 0.95; // Horizontal friction
                vel.z *= 0.95;
            }
        }
    }
    
    // For local player
    if (player === localPlayer) {
        velocity.y -= 30 * cappedDelta; // Gravity
        velocity.x *= Math.pow(airResistance, cappedDelta * 60);
        velocity.z *= Math.pow(airResistance, cappedDelta * 60);
        
        // Ground collision - smooth handling
        if (localPlayer.position.y < groundLevel) {
            const penetration = groundLevel - localPlayer.position.y;
            // Smooth push up (less aggressive to prevent jitter)
            localPlayer.position.y = groundLevel;
            
            if (velocity.y < 0) {
                // Strong dampen on ground (friction)
                velocity.y *= 0.1;
                velocity.x *= 0.95; // Horizontal friction
                velocity.z *= 0.95;
            }
        }
    }
    
    // ===== GROUND EFFECTS ON RAGDOLL =====
    // When on ground, apply friction to all rotations (floor affects ragdoll)
    // Check if torso is horizontal (lying flat on ground)
    const bodyRotX = player.userData.body ? player.userData.body.rotation.x : 0;
    const isHorizontal = Math.abs(bodyRotX) < 0.3 || 
                        Math.abs(bodyRotX - Math.PI) < 0.3 || 
                        Math.abs(bodyRotX - Math.PI/2) < 0.3 || 
                        Math.abs(bodyRotX + Math.PI/2) < 0.3;
    
    // Stop all rotations when horizontal for the third time
    if (isOnGround && isHorizontal && state.horizontalHitCount >= 3) {
        // Third time horizontal on ground - stop all rotations immediately
        state.torsoAngVel.x = 0;
        state.torsoAngVel.y = 0;
        state.torsoAngVel.z = 0;
        
        // Also stop limb rotations on ground when horizontal for third time
        state.leftArmAngVel.x = 0;
        state.leftArmAngVel.z = 0;
        state.rightArmAngVel.x = 0;
        state.rightArmAngVel.z = 0;
        state.leftLegAngVel.x = 0;
        state.leftLegAngVel.z = 0;
        state.rightLegAngVel.x = 0;
        state.rightLegAngVel.z = 0;
    } else if (isOnGround) {
        // On ground but not horizontal enough times - apply friction
        const groundFriction = 0.92; // Strong friction
        state.torsoAngVel.x *= groundFriction;
        state.torsoAngVel.y *= groundFriction;
        state.torsoAngVel.z *= groundFriction;
        
        // Also dampen limb rotations on ground
        state.leftArmAngVel.x *= groundFriction;
        state.leftArmAngVel.z *= groundFriction;
        state.rightArmAngVel.x *= groundFriction;
        state.rightArmAngVel.z *= groundFriction;
        state.leftLegAngVel.x *= groundFriction;
        state.leftLegAngVel.z *= groundFriction;
        state.rightLegAngVel.x *= groundFriction;
        state.rightLegAngVel.z *= groundFriction;
    }
    
    // Auto-recover from ragdoll after 3 seconds
    if (player.userData.ragdollTime > 3.0) {
        player.userData.isRagdoll = false;
        
        // Reset all rotations to initial values
        if (player.userData.initialRotations) {
            const init = player.userData.initialRotations;
            
            // Reset root rotation (should be 0,0,0 normally)
            player.rotation.x = init.root.x;
            player.rotation.y = init.root.y;
            player.rotation.z = init.root.z;
            
            // Reset body rotation (THIS IS CRITICAL - body rotates independently now)
            if (player.userData.body) {
                player.userData.body.rotation.x = init.body.x;
                player.userData.body.rotation.y = init.body.y;
                player.userData.body.rotation.z = init.body.z;
            }
            
            // Reset head rotation (should match body)
            if (player.userData.head) {
                player.userData.head.rotation.x = init.head.x;
                player.userData.head.rotation.y = init.head.y;
                player.userData.head.rotation.z = init.head.z;
            }
            
            // Reset limb rotations
            if (player.userData.leftArmGroup) {
                player.userData.leftArmGroup.rotation.x = init.leftArm.x;
                player.userData.leftArmGroup.rotation.z = init.leftArm.z;
            }
            if (player.userData.rightArmGroup) {
                player.userData.rightArmGroup.rotation.x = init.rightArm.x;
                player.userData.rightArmGroup.rotation.z = init.rightArm.z;
            }
            if (player.userData.leftLegGroup) {
                player.userData.leftLegGroup.rotation.x = init.leftLeg.x;
                player.userData.leftLegGroup.rotation.z = init.leftLeg.z;
            }
            if (player.userData.rightLegGroup) {
                player.userData.rightLegGroup.rotation.x = init.rightLeg.x;
                player.userData.rightLegGroup.rotation.z = init.rightLeg.z;
            }
        }
        
        // Clear ragdoll data
        player.userData.ragdollState = null;
        player.userData.initialRotations = null;
        
        if (player === localPlayer) {
            isRagdoll = false;
            // Reset velocity when recovering
            velocity.x = 0;
            velocity.z = 0;
        } else {
            // Clear ragdoll velocity for other players
            player.userData.ragdollVelocity = null;
        }
    }
}

// Animate stickman (smooth, fluid walking animation matching video style with joints)
function animateStickman(player, delta) {
    // Skip normal animation if ragdoll is active
    if (player.userData.isRagdoll) {
        updateRagdoll(player, delta);
        return;
    }
    
    // Check if player is jumping or falling - jump animation takes priority
    const isJumpingOrFalling = player.userData.isJumping || (player === localPlayer && !canJump && velocity.y !== 0);
    
    // Skip walking animation if jumping/falling (jump animation handles it)
    if (isJumpingOrFalling) {
        return;
    }
    
    if (!player.userData.isMoving) {
        // Smoothly return to default pose
        if (!player.userData.animationTime) player.userData.animationTime = 0;
        player.userData.animationTime *= 0.9; // Decay animation
        
        // Reset arms (rotate arm groups back to default - straight down)
        // But preserve swing offset if swinging an item
        const swingOffset = player.userData.swingOffset || 0;
        
        // Arms are rotated 180 degrees, so default is 0
        if (player.userData.leftArmGroup) {
            player.userData.leftArmGroup.rotation.x = THREE.MathUtils.lerp(player.userData.leftArmGroup.rotation.x, 0, 0.1);
            player.userData.leftArmGroup.position.z = THREE.MathUtils.lerp(player.userData.leftArmGroup.position.z, 0, 0.1);
            if (player.userData.leftForearm) {
                player.userData.leftForearm.rotation.x = THREE.MathUtils.lerp(player.userData.leftForearm.rotation.x, 0, 0.1);
                player.userData.leftForearm.position.z = THREE.MathUtils.lerp(player.userData.leftForearm.position.z, -0.02, 0.1); // Reset forearm back position
            }
        }
        if (player.userData.rightArmGroup) {
            // Apply swing offset even when not moving (for item use animation) - stronger animation
            player.userData.rightArmGroup.rotation.x = THREE.MathUtils.lerp(player.userData.rightArmGroup.rotation.x, swingOffset, 0.3);
            player.userData.rightArmGroup.position.z = THREE.MathUtils.lerp(player.userData.rightArmGroup.position.z, 0, 0.1);
            if (player.userData.rightForearm) {
                // Add swing offset to elbow bend - stronger when standing still
                const baseElbowBend = 0;
                const swingElbowBend = Math.abs(swingOffset) * 0.6; // Increased from 0.3 to 0.6 for stronger animation
                player.userData.rightForearm.rotation.x = THREE.MathUtils.lerp(player.userData.rightForearm.rotation.x, baseElbowBend + swingElbowBend, 0.3);
                player.userData.rightForearm.position.z = THREE.MathUtils.lerp(player.userData.rightForearm.position.z, -0.02, 0.1); // Reset forearm back position
            }
        }
        
        // Reset legs (rotate leg groups back to default)
        if (player.userData.leftLegGroup) {
            player.userData.leftLegGroup.rotation.x = THREE.MathUtils.lerp(player.userData.leftLegGroup.rotation.x, 0, 0.1);
            player.userData.leftLegGroup.position.z = THREE.MathUtils.lerp(player.userData.leftLegGroup.position.z, 0, 0.1);
            if (player.userData.leftShin) {
                player.userData.leftShin.rotation.x = THREE.MathUtils.lerp(player.userData.leftShin.rotation.x, 0, 0.1);
                player.userData.leftShin.position.z = THREE.MathUtils.lerp(player.userData.leftShin.position.z, -0.02, 0.1); // Reset shin back position
            }
        }
        if (player.userData.rightLegGroup) {
            player.userData.rightLegGroup.rotation.x = THREE.MathUtils.lerp(player.userData.rightLegGroup.rotation.x, 0, 0.1);
            player.userData.rightLegGroup.position.z = THREE.MathUtils.lerp(player.userData.rightLegGroup.position.z, 0, 0.1);
            if (player.userData.rightShin) {
                player.userData.rightShin.rotation.x = THREE.MathUtils.lerp(player.userData.rightShin.rotation.x, 0, 0.1);
                player.userData.rightShin.position.z = THREE.MathUtils.lerp(player.userData.rightShin.position.z, -0.02, 0.1); // Reset shin back position
            }
        }
        
        // Reset body position when not moving
        if (player.userData.body) {
            player.userData.body.position.y = THREE.MathUtils.lerp(player.userData.body.position.y, 0.65, 0.1);
            player.userData.body.rotation.x = THREE.MathUtils.lerp(player.userData.body.rotation.x, 0, 0.1);
            player.userData.body.rotation.z = THREE.MathUtils.lerp(player.userData.body.rotation.z, 0, 0.1);
        }
        if (player.userData.head) {
            // Head is now a child of body, so position is relative to body center
            // Body top is at bodyHeight/2 = 0.35, head should float above at 0.78 (0.35 + 0.13 gap + 0.3 radius)
            player.userData.head.position.y = THREE.MathUtils.lerp(player.userData.head.position.y, 0.78, 0.1);
            player.userData.head.position.z = THREE.MathUtils.lerp(player.userData.head.position.z, 0, 0.1); // Reset head forward position
            player.userData.head.rotation.x = THREE.MathUtils.lerp(player.userData.head.rotation.x, 0, 0.1); // Reset head rotation
        }
        return;
    }

    // Check if player is sprinting
    // For local player, check moveState.sprint; for other players, check userData.isSprinting
    const isSprinting = (player === localPlayer && moveState.sprint) || player.userData.isSprinting;
    
    // Update animation time - double speed when sprinting
    if (!player.userData.animationTime) player.userData.animationTime = 0;
    const animationSpeed = isSprinting ? 6 * 2.0 : 6; // Double speed when sprinting
    player.userData.animationTime += delta * animationSpeed;

    // Leg animation - swing forward/backward (rotation around X axis)
    // Consistent swing amplitude for both walking and running
    const legSwingAmplitude = 0.6; // Consistent swing range
    const legSwing = Math.sin(player.userData.animationTime) * legSwingAmplitude;
    
    // Calculate pivot offsets based on torso lean angle
    // When torso leans forward, hips (below center) move back, shoulders (above center) move forward
    // Body center is at y=0.65, shoulders at y=1.0 (0.35 above), hips at y=0.5 (0.15 below)
    const sprintLeanAngle = isSprinting ? Math.PI / 9 : 0; // 20 degrees when sprinting
    const shoulderHeight = 1.0 - 0.65; // 0.35 above body center
    const hipHeight = 0.5 - 0.65; // -0.15 below body center (negative)
    
    // Shoulders move forward when leaning: forward offset = height * sin(angle)
    const targetShoulderForwardOffset = shoulderHeight * Math.sin(sprintLeanAngle);
    // Hips move back when leaning: backward offset = height * sin(angle) (height is negative, so this is backward)
    const targetHipBackOffset = hipHeight * Math.sin(sprintLeanAngle);
    
    // Left leg group swings forward/back
    if (player.userData.leftLegGroup) {
        player.userData.leftLegGroup.rotation.x = legSwing;
        // Move hip pivot back when sprinting (to align with torso lean) - smooth transition
        player.userData.leftLegGroup.position.z = THREE.MathUtils.lerp(player.userData.leftLegGroup.position.z, 0.05 + targetHipBackOffset, 0.2);
        // Knee bend - shin rotates relative to thigh (increased swing)
        if (player.userData.leftShin) {
            player.userData.leftShin.rotation.x = Math.abs(legSwing) * 0.8; // Increased bend when leg is forward
        }
    }
    
    // Right leg group (opposite phase - swings opposite to left)
    if (player.userData.rightLegGroup) {
        player.userData.rightLegGroup.rotation.x = -legSwing;
        // Move hip pivot back when sprinting (to align with torso lean) - smooth transition
        player.userData.rightLegGroup.position.z = THREE.MathUtils.lerp(player.userData.rightLegGroup.position.z, 0.05 + targetHipBackOffset, 0.2);
        // Knee bend (increased swing)
        // Move shin back slightly to align joints
        if (player.userData.rightShin) {
            player.userData.rightShin.rotation.x = Math.abs(-legSwing) * 0.8; // Increased bend
            // Move shin back to align joints
            player.userData.rightShin.position.z = -0.02; // Small backward offset to align joints
        }
    }

    // Arm animation - swing forward/backward OPPOSITE to legs (natural walking/running motion)
    // Left arm swings with right leg, right arm swings with left leg
    // Consistent swing amplitude for both walking and running
    const armSwingAmplitude = 0.6; // Same amplitude as legs for consistency
    const armSwing = Math.sin(player.userData.animationTime) * armSwingAmplitude;
    
    // Left arm group (swings with right leg - opposite phase to left leg)
    if (player.userData.leftArmGroup) {
        player.userData.leftArmGroup.rotation.x = -armSwing; // Opposite to left leg (when left leg forward, left arm back)
        // Move shoulder pivot forward when sprinting (to align with torso lean) - smooth transition
        // Base position is -0.05, add forward offset based on lean
        player.userData.leftArmGroup.position.z = THREE.MathUtils.lerp(player.userData.leftArmGroup.position.z, -0.05 + targetShoulderForwardOffset, 0.2);
        // Elbow bend - forearm rotates relative to upper arm (increased swing)
        // Move forearm back slightly to align joints
        if (player.userData.leftForearm) {
            player.userData.leftForearm.rotation.x = Math.abs(-armSwing) * 0.6; // Increased elbow bend when swinging
            // Move forearm back to align joints
            player.userData.leftForearm.position.z = -0.02; // Small backward offset to align joints
        }
    }
    
    // Right arm group (swings with left leg - opposite phase to right leg)
    if (player.userData.rightArmGroup) {
        // Get swing offset from item use animation (if any)
        const swingOffset = player.userData.swingOffset || 0;
        
        // Add swing offset to walking animation (item use adds to walking, doesn't replace it)
        player.userData.rightArmGroup.rotation.x = armSwing + swingOffset; // Opposite to right leg (when right leg forward, right arm back)
        // Move shoulder pivot forward when sprinting (to align with torso lean) - smooth transition
        // Base position is -0.05, add forward offset based on lean
        player.userData.rightArmGroup.position.z = THREE.MathUtils.lerp(player.userData.rightArmGroup.position.z, -0.05 + targetShoulderForwardOffset, 0.2);
        // Elbow bend (increased swing)
        // Move forearm back slightly to align joints
        if (player.userData.rightForearm) {
            // Add swing offset to elbow bend as well for more natural movement
            const baseElbowBend = Math.abs(armSwing) * 0.6;
            const swingElbowBend = Math.abs(swingOffset) * 0.3; // Additional bend from swing
            player.userData.rightForearm.rotation.x = baseElbowBend + swingElbowBend;
            // Move forearm back to align joints
            player.userData.rightForearm.position.z = -0.02; // Small backward offset to align joints
        }
    }
    
    // Body animation - bounce and lean like in video
    if (player.userData.body) {
        // Body bounce (up and down)
        const bounceAmount = Math.sin(player.userData.animationTime * 2) * 0.03;
        
        // Lift torso slightly when sprinting
        const sprintLift = isSprinting ? 0.05 : 0;
        const targetBodyY = 0.65 + bounceAmount + sprintLift;
        player.userData.body.position.y = THREE.MathUtils.lerp(player.userData.body.position.y, targetBodyY, 0.2);
        
        // Body lean (forward/backward and side to side)
        const leanForward = Math.sin(player.userData.animationTime) * 0.05;
        const leanSide = Math.sin(player.userData.animationTime * 0.5) * 0.03;
        
        // Add 20 degree forward lean when sprinting (Math.PI / 9 radians) - smooth transition
        const targetSprintLean = isSprinting ? Math.PI / 9 : 0;
        const currentLean = player.userData.body.rotation.x - leanForward;
        const newLean = THREE.MathUtils.lerp(currentLean, targetSprintLean, 0.2);
        player.userData.body.rotation.x = leanForward + newLean;
        player.userData.body.rotation.z = leanSide;
    }
    
    // Head bounce with body (should stay at same height, just bounce)
    if (player.userData.head) {
        const headBounce = Math.sin(player.userData.animationTime * 2) * 0.02;
        
        // Head is now a child of body, so position is relative to body center
        // Body top is at bodyHeight/2 = 0.35, head should float above at 0.78 (0.35 + 0.13 gap + 0.3 radius) + bounce
        const targetHeadY = 0.78 + headBounce;
        player.userData.head.position.y = THREE.MathUtils.lerp(player.userData.head.position.y, targetHeadY, 0.2);
        
        // Keep head centered on torso even when inclined (no forward offset)
        // Head should stay centered on body regardless of body lean
        player.userData.head.position.z = THREE.MathUtils.lerp(player.userData.head.position.z, 0, 0.2);
        // Head rotation stays at 0 - it rotates with body since it's a child
        player.userData.head.rotation.x = 0;
    }
}

// Setup building menu
function setupBuildingMenu() {
    const blockSelectors = document.querySelectorAll('.block-selector');
    blockSelectors.forEach(selector => {
        selector.addEventListener('click', () => {
            blockSelectors.forEach(s => s.classList.remove('active'));
            selector.classList.add('active');
            selectedBlockType = selector.dataset.block;
        });
    });
}

// Update build mode UI
function updateBuildModeUI() {
    const instructions = document.getElementById('instructions');
    if (instructions && !inventoryOpen) {
        if (buildMode === 'build') {
            instructions.innerHTML = `
                <p><strong>WASD</strong> - Move | <strong>Shift</strong> - Sprint | <strong>Space</strong> - Jump | <strong>Right Click + Drag</strong> - Look around</p>
                <p><strong>Q</strong> - Cycle Mode | <strong>F</strong> - Inventory | <strong>Left Click</strong> - Place block | <strong>Mode: BUILD</strong></p>
            `;
        } else if (buildMode === 'delete') {
            instructions.innerHTML = `
                <p><strong>WASD</strong> - Move | <strong>Shift</strong> - Sprint | <strong>Space</strong> - Jump | <strong>Right Click + Drag</strong> - Look around</p>
                <p><strong>Q</strong> - Cycle Mode | <strong>F</strong> - Inventory | <strong>Left Click</strong> - Delete block | <strong>Mode: DELETE</strong></p>
            `;
        } else {
            const itemName = localPlayer && localPlayer.userData.equippedItem ? localPlayer.userData.equippedItem : 'None';
            instructions.innerHTML = `
                <p><strong>WASD</strong> - Move | <strong>Shift</strong> - Sprint | <strong>Space</strong> - Jump | <strong>Right Click + Drag</strong> - Look around</p>
                <p><strong>Q</strong> - Cycle Mode | <strong>F</strong> - Inventory | <strong>Left Click</strong> - Use ${itemName} | <strong>Mode: ITEM</strong></p>
            `;
        }
    }
}

// Swing arm animation for block placement/destruction
function swingArm(player) {
    if (!player || !player.userData.rightArmGroup) return;
    
    player.userData.swingTime = 0;
    player.userData.isSwinging = true;
    
    // Animate right arm swinging forward
    const originalRotation = player.userData.rightArmGroup.rotation.x;
    const swingAnimation = () => {
        if (!player.userData.isSwinging) return;
        
        player.userData.swingTime += 0.05;
        if (player.userData.swingTime < 0.3) {
            // Swing forward (negative rotation swings forward since arms are rotated 180)
            const swingAmount = Math.sin(player.userData.swingTime * Math.PI / 0.3) * 1.2;
            player.userData.rightArmGroup.rotation.x = originalRotation - swingAmount; // Negative for forward swing
            requestAnimationFrame(swingAnimation);
        } else if (player.userData.swingTime < 0.6) {
            // Swing back
            const t = (player.userData.swingTime - 0.3) / 0.3;
            const swingAmount = 1.2 * (1 - t);
            player.userData.rightArmGroup.rotation.x = originalRotation - swingAmount;
            requestAnimationFrame(swingAnimation);
        } else {
            // Reset
            player.userData.rightArmGroup.rotation.x = originalRotation;
            player.userData.isSwinging = false;
        }
    };
    swingAnimation();
}

// Helper function to remove item from hand
function removeItemFromHand(player) {
    if (!player || !player.userData.equippedItemMesh) return;
    
    const itemMesh = player.userData.equippedItemMesh;
    
    // Remove from parent (could be forearm or hand joint)
    if (itemMesh.parent) {
        itemMesh.parent.remove(itemMesh);
    }
    
    // Dispose geometry if it exists
    if (itemMesh.geometry) {
        itemMesh.geometry.dispose();
    }
    
    // Dispose materials - handle both single materials and arrays
    if (itemMesh.material) {
        if (Array.isArray(itemMesh.material)) {
            itemMesh.material.forEach(mat => {
                if (mat && mat.dispose) {
                    mat.dispose();
                }
            });
        } else if (itemMesh.material.dispose) {
            itemMesh.material.dispose();
        }
    }
    
    // Dispose materials from children (for Groups)
    if (itemMesh.children && itemMesh.children.length > 0) {
        itemMesh.children.forEach(child => {
            if (child.geometry && child.geometry.dispose) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        if (mat && mat.dispose) {
                            mat.dispose();
                        }
                    });
                } else if (child.material.dispose) {
                    child.material.dispose();
                }
            }
        });
    }
    
    player.userData.equippedItemMesh = null;
}

// Helper function to attach item to hand joint
function attachItemToHand(player, itemMesh) {
    if (!player || !itemMesh) {
        console.log('attachItemToHand: Missing requirements', {
            player: !!player,
            itemMesh: !!itemMesh
        });
        return;
    }
    
    // Get the forearm - attach directly to forearm at hand position
    const forearm = player.userData.rightForearm;
    if (!forearm) {
        console.error('Missing rightForearm!');
        return;
    }
    
    // Attach item directly to forearm at the hand position
    // Hand joint is at y = forearmLength/2 = 0.15 in forearm's local space
    // Lower the position much more to align with the hand ball center
    // Move slightly forward so hand is centered on handle
    itemMesh.castShadow = true;
    itemMesh.position.set(0, 0.15 - 0.3, -0.075); // Position at hand (lowered more, moved back slightly to center hand on handle)
    forearm.add(itemMesh);
    player.userData.equippedItemMesh = itemMesh;
    
    // Ensure item is visible
    itemMesh.visible = true;
    if (itemMesh.children && itemMesh.children.length > 0) {
        itemMesh.children.forEach(child => {
            child.visible = true;
            child.castShadow = true;
            // Recursively ensure all nested children are visible
            if (child.children && child.children.length > 0) {
                child.children.forEach(grandchild => {
                    grandchild.visible = true;
                    grandchild.castShadow = true;
                });
            }
        });
    }
    
    // Verify the item is in the scene
    const worldPos = new THREE.Vector3();
    itemMesh.getWorldPosition(worldPos);
    console.log('Item attached to hand:', itemMesh.type || itemMesh.constructor.name, 
                'Parent:', player.userData.rightHandJoint,
                'World Position:', worldPos,
                'Item visible:', itemMesh.visible,
                'Item in scene:', itemMesh.parent !== null && itemMesh.parent.parent !== null);
}

// Create item model in player's hand
function createItemInHand(player, itemType) {
    if (!player || !player.userData.rightForearm) {
        console.log('createItemInHand: Missing player or rightForearm', {
            player: !!player,
            rightForearm: !!player?.userData?.rightForearm
        });
        return;
    }
    
    console.log('Creating item in hand:', itemType);
    
    // Remove existing item if any
    removeItemFromHand(player);
    
    if (!itemType) {
        console.log('createItemInHand: No itemType provided');
        return;
    }
    
    const metalMaterial = new THREE.MeshStandardMaterial({
        metalness: 0.95,
        roughness: 0.1,
        envMapIntensity: 1.5
    });
    
    let itemMesh;
    
    if (itemType === 'sword') {
        // Create sword model - built with origin at the grip (where hand holds it)
        const swordGroup = new THREE.Group();
        
        const bladeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xe8e8e8,
            metalness: 0.95,
            roughness: 0.05,
            envMapIntensity: 1.5
        });
        
        const hiltMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x654321,
            metalness: 0.2,
            roughness: 0.8
        });
        
        const guardMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x888888,
            metalness: 0.8,
            roughness: 0.2
        });
        
        // Sword dimensions - made larger and more visible
        const bladeLength = 0.8;
        const bladeWidth = 0.08;
        const bladeThickness = 0.03;
        const hiltLength = 0.2;
        const hiltRadius = 0.06;
        
        // Build sword with origin at the grip (top of hilt, where hand holds it)
        // Blade extends forward (+z), hilt extends backward (-z)
        
        // Main blade body - extends forward from grip
        const bladeGeometry = new THREE.BoxGeometry(bladeThickness, bladeWidth, bladeLength);
        const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
        blade.position.z = bladeLength / 2; // Center of blade is forward
        blade.castShadow = true;
        swordGroup.add(blade);
        
        // Cross guard (horizontal) - at the base of the blade
        const guardGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.05);
        const guard = new THREE.Mesh(guardGeometry, guardMaterial);
        guard.position.z = 0; // At the grip position
        guard.castShadow = true;
        swordGroup.add(guard);
        
        // Hilt/grip - extends backward from grip
        const hiltGeometry = new THREE.CylinderGeometry(hiltRadius, hiltRadius, hiltLength, 8);
        const hilt = new THREE.Mesh(hiltGeometry, hiltMaterial);
        hilt.rotation.x = Math.PI / 2; // Rotate to extend along z-axis
        hilt.position.z = -hiltLength / 2; // Center of hilt is backward
        hilt.castShadow = true;
        swordGroup.add(hilt);
        
        // Pommel (end of hilt) - at the back
        const pommelGeometry = new THREE.SphereGeometry(0.08, 8, 8);
        const pommel = new THREE.Mesh(pommelGeometry, guardMaterial);
        pommel.position.z = -hiltLength; // At the end of hilt
        pommel.castShadow = true;
        swordGroup.add(pommel);
        
        // Position and orient sword in hand
        // Sword is attached to rightHandJoint (the hand ball)
        // Hand joint is at origin of its local space
        // Rotate so blade points forward (in +z direction)
        
        swordGroup.rotation.x = 0; // Reset x rotation so it points forward
        swordGroup.rotation.y = -Math.PI; // Rotate to point forward (using 1 instead of 2)
        swordGroup.rotation.z = 0;
        
        // Make sure the entire group is visible
        swordGroup.visible = true;
        
        // Position will be set by attachItemToHand
        itemMesh = swordGroup;
        
    } else if (itemType === 'cheeseburger') {
        // Create cheeseburger - built with origin at grip point
        const burgerGroup = new THREE.Group();
        
        // Bottom bun
        const bottomBunGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16);
        const bunMaterial = new THREE.MeshStandardMaterial({ color: 0xf4a460 });
        const bottomBun = new THREE.Mesh(bottomBunGeometry, bunMaterial);
        bottomBun.rotation.x = Math.PI / 2;
        bottomBun.position.z = -0.05;
        burgerGroup.add(bottomBun);
        
        // Meat patty
        const pattyGeometry = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16);
        const pattyMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
        const patty = new THREE.Mesh(pattyGeometry, pattyMaterial);
        patty.rotation.x = Math.PI / 2;
        patty.position.z = -0.02;
        burgerGroup.add(patty);
        
        // Cheese
        const cheeseGeometry = new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16);
        const cheeseMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
        const cheese = new THREE.Mesh(cheeseGeometry, cheeseMaterial);
        cheese.rotation.x = Math.PI / 2;
        cheese.position.z = 0;
        burgerGroup.add(cheese);
        
        // Top bun
        const topBun = new THREE.Mesh(bottomBunGeometry, bunMaterial);
        topBun.rotation.x = Math.PI / 2;
        topBun.position.z = 0.03;
        burgerGroup.add(topBun);
        
        // Rotate so burger is held horizontally
        burgerGroup.rotation.x = Math.PI / 2;
        burgerGroup.rotation.y = 0;
        burgerGroup.rotation.z = 0;
        // Position will be set by attachItemToHand
        itemMesh = burgerGroup;
        
    } else if (itemType === 'soda') {
        // Create soda can - built with origin at grip point
        const canGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.15, 16);
        const canMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xff0000,
            metalness: 0.8,
            roughness: 0.2
        });
        const can = new THREE.Mesh(canGeometry, canMaterial);
        // Rotate so can is held vertically
        can.rotation.x = Math.PI / 2;
        // Position will be set by attachItemToHand
        itemMesh = can;
    } else if (itemType === 'baseballbat') {
        // Create baseball bat - built with origin at grip point
        const batGroup = new THREE.Group();
        
        const batMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8b4513, // Brown wood color
            metalness: 0.1,
            roughness: 0.9
        });
        
        const handleMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x654321, // Darker brown for grip
            metalness: 0.1,
            roughness: 0.9
        });
        
        // Bat dimensions
        const batLength = 0.7;
        const handleLength = 0.2;
        const handleRadius = 0.04;
        const barrelRadius = 0.06;
        
        // Handle/grip - extends backward from grip point
        const handleGeometry = new THREE.CylinderGeometry(handleRadius, handleRadius, handleLength, 8);
        const handle = new THREE.Mesh(handleGeometry, handleMaterial);
        handle.rotation.x = Math.PI / 2; // Rotate to extend along z-axis
        handle.position.z = -handleLength / 2; // Center of handle is backward
        handle.castShadow = true;
        batGroup.add(handle);
        
        // Barrel/main body - extends forward from grip
        const barrelGeometry = new THREE.CylinderGeometry(barrelRadius, handleRadius, batLength - handleLength, 8);
        const barrel = new THREE.Mesh(barrelGeometry, batMaterial);
        barrel.rotation.x = Math.PI / 2; // Rotate to extend along z-axis
        barrel.position.z = (batLength - handleLength) / 2; // Center of barrel is forward
        barrel.castShadow = true;
        batGroup.add(barrel);
        
        // Rotate so bat points forward (same as sword)
        batGroup.rotation.x = 0;
        batGroup.rotation.y = -Math.PI; // Rotate to point forward (same as sword)
        batGroup.rotation.z = 0;
        batGroup.castShadow = true;
        // Position will be set by attachItemToHand
        itemMesh = batGroup;
    }
    
    // Attach item to hand using helper function
    if (itemMesh) {
        console.log('Item mesh created, attaching to hand:', itemMesh);
        attachItemToHand(player, itemMesh);
        
        // Verify the item is in the scene hierarchy
        let current = itemMesh;
        let hierarchy = [];
        while (current) {
            hierarchy.push(current.constructor.name);
            current = current.parent;
        }
        console.log('Item scene hierarchy:', hierarchy.join(' -> '));
        
        // Get world position to verify it's positioned correctly
        const worldPos = new THREE.Vector3();
        itemMesh.getWorldPosition(worldPos);
        console.log('Item world position:', worldPos);
        console.log('Item attached, checking visibility:', {
            itemVisible: itemMesh.visible,
            itemInScene: itemMesh.parent !== null,
            handJointInScene: player.userData.rightHandJoint.parent !== null,
            handJointVisible: player.userData.rightHandJoint.visible
        });
    } else {
        console.log('No item mesh created for itemType:', itemType);
    }
}

// Jump animation
function jumpAnimation(player) {
    if (!player) return;
    
    player.userData.jumpTime = 0;
    player.userData.isJumping = true;
    
    const originalLeftLegRot = player.userData.leftLegGroup ? player.userData.leftLegGroup.rotation.x : 0;
    const originalRightLegRot = player.userData.rightLegGroup ? player.userData.rightLegGroup.rotation.x : 0;
    const originalLeftArmRot = player.userData.leftArmGroup ? player.userData.leftArmGroup.rotation.x : 0;
    const originalRightArmRot = player.userData.rightArmGroup ? player.userData.rightArmGroup.rotation.x : 0;
    const originalBodyY = player.userData.body ? player.userData.body.position.y : 0.65;
    
    const jumpAnim = () => {
        if (!player.userData.isJumping) return;
        
        player.userData.jumpTime += 0.016; // ~60fps
        
        if (player.userData.jumpTime < 0.12) {
            // Crouch phase - bend legs and lower body more dramatically
            const crouchProgress = player.userData.jumpTime / 0.12;
            const crouchAmount = Math.sin(crouchProgress * Math.PI / 2) * 0.4; // Smooth crouch
            
            if (player.userData.leftLegGroup) {
                player.userData.leftLegGroup.rotation.x = originalLeftLegRot - crouchAmount;
            }
            if (player.userData.rightLegGroup) {
                player.userData.rightLegGroup.rotation.x = originalRightLegRot - crouchAmount;
            }
            if (player.userData.body) {
                player.userData.body.position.y = originalBodyY - crouchAmount * 0.3;
            }
            if (player.userData.leftShin) {
                player.userData.leftShin.rotation.x = -crouchAmount * 0.6;
            }
            if (player.userData.rightShin) {
                player.userData.rightShin.rotation.x = -crouchAmount * 0.6;
            }
            // Arms go back during crouch, and bend elbows
            if (player.userData.leftArmGroup) {
                player.userData.leftArmGroup.rotation.x = originalLeftArmRot + crouchAmount * 0.3;
                // Bend elbow during crouch
                if (player.userData.leftForearm) {
                    player.userData.leftForearm.rotation.x = crouchAmount * 0.5;
                }
            }
            if (player.userData.rightArmGroup) {
                player.userData.rightArmGroup.rotation.x = originalRightArmRot + crouchAmount * 0.3;
                // Bend elbow during crouch
                if (player.userData.rightForearm) {
                    player.userData.rightForearm.rotation.x = crouchAmount * 0.5;
                }
            }
            
            requestAnimationFrame(jumpAnim);
        } else if (player.userData.jumpTime < 0.35) {
            // Jump phase - extend legs and lift arms up and sideways
            const jumpProgress = (player.userData.jumpTime - 0.12) / 0.23;
            const jumpAmount = Math.sin(jumpProgress * Math.PI) * 0.5; // More dramatic extension
            
            if (player.userData.leftLegGroup) {
                player.userData.leftLegGroup.rotation.x = originalLeftLegRot + jumpAmount;
            }
            if (player.userData.rightLegGroup) {
                player.userData.rightLegGroup.rotation.x = originalRightLegRot + jumpAmount;
            }
            // Arms lift up and go sideways during jump (not too much)
            const armLiftAmount = jumpAmount * 0.8;
            const armSidewaysAmount = Math.sin(jumpProgress * Math.PI) * 0.3; // Sideways movement (not too much)
            if (player.userData.leftArmGroup) {
                player.userData.leftArmGroup.rotation.x = originalLeftArmRot - armLiftAmount;
                player.userData.leftArmGroup.rotation.z = -armSidewaysAmount; // Left arm swings left (negative)
                // Bend elbow during jump
                if (player.userData.leftForearm) {
                    player.userData.leftForearm.rotation.x = armLiftAmount * 0.4;
                }
            }
            if (player.userData.rightArmGroup) {
                player.userData.rightArmGroup.rotation.x = originalRightArmRot - armLiftAmount;
                player.userData.rightArmGroup.rotation.z = armSidewaysAmount; // Right arm swings right (positive)
                // Bend elbow during jump
                if (player.userData.rightForearm) {
                    player.userData.rightForearm.rotation.x = armLiftAmount * 0.4;
                }
            }
            if (player.userData.body) {
                player.userData.body.position.y = originalBodyY + jumpAmount * 0.15;
            }
            // Bend knees during jump extension
            if (player.userData.leftShin) {
                player.userData.leftShin.rotation.x = jumpAmount * 0.6; // More knee bend
            }
            if (player.userData.rightShin) {
                player.userData.rightShin.rotation.x = jumpAmount * 0.6; // More knee bend
            }
            
            requestAnimationFrame(jumpAnim);
        } else if (player.userData.jumpTime < 0.8) {
            // Air phase - tuck legs, maintain arm position with sideways movement
            const airProgress = (player.userData.jumpTime - 0.35) / 0.45;
            const tuckAmount = Math.sin(airProgress * Math.PI) * 0.3; // Tuck legs in air
            
            if (player.userData.leftLegGroup) {
                player.userData.leftLegGroup.rotation.x = originalLeftLegRot + 0.2 - tuckAmount;
            }
            if (player.userData.rightLegGroup) {
                player.userData.rightLegGroup.rotation.x = originalRightLegRot + 0.2 - tuckAmount;
            }
            // Arms stay up with sideways movement (not too much)
            const armSideways = Math.sin(airProgress * Math.PI) * 0.25; // Sideways in air
            if (player.userData.leftArmGroup) {
                player.userData.leftArmGroup.rotation.x = originalLeftArmRot - 0.3 * (1 - airProgress * 0.5);
                player.userData.leftArmGroup.rotation.z = -armSideways; // Left arm swings left (negative)
                // Keep elbow bent
                if (player.userData.leftForearm) {
                    player.userData.leftForearm.rotation.x = 0.3 * 0.4;
                }
            }
            if (player.userData.rightArmGroup) {
                player.userData.rightArmGroup.rotation.x = originalRightArmRot - 0.3 * (1 - airProgress * 0.5);
                player.userData.rightArmGroup.rotation.z = armSideways; // Right arm swings right (positive)
                // Keep elbow bent
                if (player.userData.rightForearm) {
                    player.userData.rightForearm.rotation.x = 0.3 * 0.4;
                }
            }
            // Keep knees bent in air
            if (player.userData.leftShin) {
                player.userData.leftShin.rotation.x = 0.3;
            }
            if (player.userData.rightShin) {
                player.userData.rightShin.rotation.x = 0.3;
            }
            
            requestAnimationFrame(jumpAnim);
        } else {
            // Reset to normal (landing handled by canJump)
            if (player.userData.leftLegGroup) {
                player.userData.leftLegGroup.rotation.x = originalLeftLegRot;
            }
            if (player.userData.rightLegGroup) {
                player.userData.rightLegGroup.rotation.x = originalRightLegRot;
            }
            if (player.userData.leftArmGroup) {
                player.userData.leftArmGroup.rotation.x = originalLeftArmRot;
                player.userData.leftArmGroup.rotation.z = 0; // Reset sideways
            }
            if (player.userData.rightArmGroup) {
                player.userData.rightArmGroup.rotation.x = originalRightArmRot;
                player.userData.rightArmGroup.rotation.z = 0; // Reset sideways
            }
            // Reset elbow rotations
            if (player.userData.leftForearm) {
                player.userData.leftForearm.rotation.x = 0;
            }
            if (player.userData.rightForearm) {
                player.userData.rightForearm.rotation.x = 0;
            }
            if (player.userData.body) {
                player.userData.body.position.y = originalBodyY;
            }
            if (player.userData.leftShin) {
                player.userData.leftShin.rotation.x = 0;
            }
            if (player.userData.rightShin) {
                player.userData.rightShin.rotation.x = 0;
            }
            player.userData.isJumping = false;
        }
    };
    jumpAnim();
}

// Update inventory UI
function updateInventoryUI() {
    let inventoryDiv = document.getElementById('inventory');
    if (!inventoryDiv) {
        inventoryDiv = document.createElement('div');
        inventoryDiv.id = 'inventory';
        inventoryDiv.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            padding: 30px;
            border-radius: 15px;
            display: none;
            z-index: 200;
            border: 3px solid #4a9eff;
        `;
        document.getElementById('ui').appendChild(inventoryDiv);
    }
    
    if (inventoryOpen) {
        inventoryDiv.style.display = 'block';
        const itemNames = { sword: '⚔️ Sword', cheeseburger: '🍔 Cheeseburger', soda: '🥤 Soda', baseballbat: '⚾ Baseball Bat' };
        inventoryDiv.innerHTML = `
            <h2 style="color: #fff; margin-bottom: 20px; text-align: center;">Inventory</h2>
            <div style="display: flex; gap: 20px; justify-content: center;">
                ${inventory.map((item, index) => `
                    <div style="
                        padding: 20px;
                        background: ${index === selectedInventoryIndex ? 'rgba(74, 158, 255, 0.5)' : 'rgba(255, 255, 255, 0.1)'};
                        border: 3px solid ${index === selectedInventoryIndex ? '#4a9eff' : '#666'};
                        border-radius: 10px;
                        cursor: pointer;
                        text-align: center;
                        min-width: 120px;
                    ">
                        <div style="font-size: 48px; margin-bottom: 10px;">${itemNames[item] || item}</div>
                        <div style="color: #fff; font-size: 14px;">${item === 'sword' ? '25 Damage' : item === 'baseballbat' ? 'Ragdoll' : item === 'cheeseburger' ? 'Heal' : 'Heal'}</div>
                    </div>
                `).join('')}
            </div>
            <p style="color: #fff; text-align: center; margin-top: 20px; font-size: 12px;">
                <strong>Q</strong> / <strong>E</strong> - Cycle | <strong>I</strong> - Close | <strong>Left Click</strong> - Use
            </p>
        `;
    } else {
        inventoryDiv.style.display = 'none';
        // Auto-equip selected item when closing inventory (only if in item mode)
        if (localPlayer && inventory[selectedInventoryIndex]) {
            const selectedItem = inventory[selectedInventoryIndex];
            // Only equip if we're in item mode (buildMode === null)
            if (buildMode === null) {
                localPlayer.userData.equippedItem = selectedItem;
                // Create/update item model in hand
                createItemInHand(localPlayer, selectedItem);
                // Sync equipped item to server
                if (socket) {
                    socket.emit('playerEquipItem', { item: selectedItem });
                }
            }
        }
        updateBuildModeUI();
    }
    
    // Update health bar if damaged
    updateHealthBar();
}

// Use selected item
function useItem(player) {
    if (!player || isUsingItem) return;
    
    const item = inventory[selectedInventoryIndex];
    if (!item) return;
    
    isUsingItem = true;
    itemUseTime = 0;
    
    if (item === 'sword') {
        // Sword attack - swing animation and damage
        swingSword(player);
        // Check for nearby players to damage (with slight delay to hit during swing)
        setTimeout(() => {
            checkSwordHit(player);
        }, 150); // Check damage mid-swing
    } else if (item === 'baseballbat') {
        // Baseball bat attack - swing animation and ragdoll launch
        swingSword(player); // Reuse sword swing animation
        // Check for nearby players to hit (with slight delay to hit during swing)
        setTimeout(() => {
            checkBatHit(player);
        }, 150); // Check hit mid-swing
    } else if (item === 'cheeseburger') {
        // Eat cheeseburger - heal
        eatItem(player, 'cheeseburger');
        if (player === localPlayer) {
            playerHealth = Math.min(maxHealth, playerHealth + 25);
            updateHealthBar();
            // Sync healing to server
            if (socket) {
                socket.emit('playerHeal', {
                    healAmount: 25,
                    health: playerHealth
                });
            }
        }
    } else if (item === 'soda') {
        // Drink soda - heal
        drinkItem(player, 'soda');
        if (player === localPlayer) {
            playerHealth = Math.min(maxHealth, playerHealth + 15);
            updateHealthBar();
            // Sync healing to server
            if (socket) {
                socket.emit('playerHeal', {
                    healAmount: 15,
                    health: playerHealth
                });
            }
        }
    }
    
    setTimeout(() => {
        isUsingItem = false;
    }, 1000);
}

// Swing sword animation
function swingSword(player) {
    if (!player.userData.rightArmGroup) return;
    
    // Initialize swing offset if not exists
    if (!player.userData.swingOffset) player.userData.swingOffset = 0;
    if (!player.userData.swingTime) player.userData.swingTime = 0;
    player.userData.isSwinging = true;
    
    // Reset swing animation
    player.userData.swingTime = 0;
    
    const animate = () => {
        if (!player.userData.isSwinging) return;
        
        player.userData.swingTime += 0.05;
        if (player.userData.swingTime < 0.3) {
            // Swing forward (negative rotation swings forward since arms are rotated 180)
            const swingAmount = Math.sin(player.userData.swingTime * Math.PI / 0.3) * 1.2;
            player.userData.swingOffset = -swingAmount; // Negative for forward swing
            requestAnimationFrame(animate);
        } else if (player.userData.swingTime < 0.6) {
            // Swing back
            const t = (player.userData.swingTime - 0.3) / 0.3;
            const swingAmount = 1.2 * (1 - t);
            player.userData.swingOffset = -swingAmount;
            requestAnimationFrame(animate);
        } else {
            // Reset swing offset
            player.userData.swingOffset = 0;
            player.userData.isSwinging = false;
        }
    };
    animate();
}

// Check if sword hits a player - 2x1 cube area in front of player
function checkSwordHit(attacker) {
    if (!attacker || attacker !== localPlayer) return;
    
    const attackAngle = attacker.rotation.y;
    const attackerPos = attacker.position;
    
    // Simple forward direction based on player rotation
    // Player rotation.y uses atan2(direction.x, direction.z)
    // When moving forward (z = -1), rotation.y = atan2(0, -1) = π
    // When moving backward (z = 1), rotation.y = atan2(0, 1) = 0
    // Forward direction is: (sin(angle), 0, cos(angle))
    const forwardX = Math.sin(attackAngle);
    const forwardZ = Math.cos(attackAngle);
    
    // Attack area: 1.5 units forward, 0.8 units wide, 1 unit tall
    // Check all other players
    let hitFound = false;
    for (const [targetId, target] of otherPlayers.entries()) {
        if (hitFound) break; // Only hit one player per swing
        
        const targetPos = target.position;
        const relativePos = targetPos.clone().sub(attackerPos);
        
        // Calculate distance in forward direction (dot product with forward vector)
        const forwardDist = relativePos.x * forwardX + relativePos.z * forwardZ;
        
        // Calculate distance perpendicular to forward (sideways distance)
        const sideDist = Math.abs(relativePos.x * forwardZ - relativePos.z * forwardX);
        
        // Calculate vertical distance (relative to attacker's position)
        const verticalDist = Math.abs(relativePos.y);
        
        // Check if target is within attack area
        // Forward: 0 to 1.5 units in front of player
        // Sideways: within 0.4 units (0.8 units wide total)
        // Vertical: within 0.5 units (1 unit tall total, centered at player height)
        if (forwardDist >= 0 && forwardDist <= 1.5 && // In front, within range
            sideDist <= 0.4 && // Within width
            verticalDist <= 0.5) { // Within height
            // Deal damage
            console.log('Sword hit player:', targetId, 'forward:', forwardDist.toFixed(2), 'side:', sideDist.toFixed(2));
            if (socket) {
                socket.emit('playerDamage', { targetId, damage: 25 });
            }
            hitFound = true;
        }
    }
}

// Check if baseball bat hits a player - launches player and triggers ragdoll
function checkBatHit(attacker) {
    if (!attacker || attacker !== localPlayer) return;
    
    const attackAngle = attacker.rotation.y;
    const attackerPos = attacker.position;
    
    // Forward direction based on player rotation (same as sword)
    const forwardX = Math.sin(attackAngle);
    const forwardZ = Math.cos(attackAngle);
    
    // Attack area: 1.5 units forward, 0.8 units wide, 1 unit tall (same as sword)
    let hitFound = false;
    for (const [targetId, target] of otherPlayers.entries()) {
        if (hitFound) break;
        
        const targetPos = target.position;
        const relativePos = targetPos.clone().sub(attackerPos);
        
        const forwardDist = relativePos.x * forwardX + relativePos.z * forwardZ;
        const sideDist = Math.abs(relativePos.x * forwardZ - relativePos.z * forwardX);
        const verticalDist = Math.abs(relativePos.y);
        
        if (forwardDist >= 0 && forwardDist <= 1.5 &&
            sideDist <= 0.4 &&
            verticalDist <= 0.5) {
            // Launch player forward approximately 10 blocks (10 units) and trigger ragdoll
            console.log('Baseball bat hit player:', targetId);
            
            // Generate initial angular velocities here (before syncing) so they're consistent
            // HUGE angular impact for torso - spins randomly before falling
            const initialAngularVelocities = {
                torso: {
                    x: (Math.random() - 0.5) * 25, // HUGE pitch rotation
                    y: (Math.random() - 0.5) * 20, // HUGE yaw rotation
                    z: (Math.random() - 0.5) * 25  // HUGE roll rotation
                },
                leftArm: { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 },
                rightArm: { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 },
                leftLeg: { x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 },
                rightLeg: { x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 }
            };
            
            if (socket) {
                socket.emit('playerBatHit', { 
                    targetId, 
                    launchDirection: { x: forwardX, y: 0.7, z: forwardZ },
                    attackerId: socket.id,
                    angularVelocities: initialAngularVelocities // Send initial angular velocities
                });
            }
            hitFound = true;
        }
    }
}

// Eat item animation
function eatItem(player, itemType) {
    if (!player.userData.rightArmGroup) return;
    
    const originalRotation = player.userData.rightArmGroup.rotation.x;
    let eatProgress = 0;
    
    const animate = () => {
        eatProgress += 0.03;
        if (eatProgress < 1.0) {
            // Bring hand to mouth
            player.userData.rightArmGroup.rotation.x = originalRotation - 0.8 + Math.sin(eatProgress * Math.PI * 2) * 0.2;
            requestAnimationFrame(animate);
        } else {
            player.userData.rightArmGroup.rotation.x = originalRotation;
        }
    };
    animate();
}

// Drink item animation
function drinkItem(player, itemType) {
    if (!player.userData.rightArmGroup) return;
    
    const originalRotation = player.userData.rightArmGroup.rotation.x;
    let drinkProgress = 0;
    
    const animate = () => {
        drinkProgress += 0.03;
        if (drinkProgress < 1.0) {
            // Bring hand to mouth
            player.userData.rightArmGroup.rotation.x = originalRotation - 0.8 + Math.sin(drinkProgress * Math.PI * 2) * 0.2;
            requestAnimationFrame(animate);
        } else {
            player.userData.rightArmGroup.rotation.x = originalRotation;
        }
    };
    animate();
}

// Update health bar
function updateHealthBar() {
    // Local player health bar (top left)
    let localHealthBar = document.getElementById('local-health-bar');
    if (playerHealth < maxHealth) {
        if (!localHealthBar) {
            localHealthBar = document.createElement('div');
            localHealthBar.id = 'local-health-bar';
            localHealthBar.style.cssText = `
                position: absolute;
                top: 80px;
                left: 20px;
                width: 200px;
                height: 20px;
                background: rgba(0, 0, 0, 0.7);
                border: 2px solid #fff;
                border-radius: 5px;
                z-index: 100;
            `;
            document.getElementById('ui').appendChild(localHealthBar);
        }
        const healthPercent = (playerHealth / maxHealth) * 100;
        localHealthBar.innerHTML = `
            <div style="
                width: ${healthPercent}%;
                height: 100%;
                background: ${healthPercent > 50 ? '#4a9eff' : healthPercent > 25 ? '#ffd93d' : '#ff6b6b'};
                transition: width 0.3s;
            "></div>
            <div style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                color: #fff;
                font-weight: bold;
                font-size: 12px;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            ">${Math.ceil(playerHealth)}/${maxHealth}</div>
        `;
    } else if (localHealthBar) {
        localHealthBar.remove();
    }
    
    // Other players health bars (above head)
    otherPlayers.forEach((player, playerId) => {
        if (player.userData.health < maxHealth) {
            updatePlayerHealthBar(player);
        } else if (player.userData.healthBar) {
            if (player.userData.healthBar.parentNode) {
                player.userData.healthBar.parentNode.removeChild(player.userData.healthBar);
            }
            player.userData.healthBar = null;
        }
    });
}

// Update individual player health bar above head
function updatePlayerHealthBar(player) {
    // Don't show health bar if player is not visible (dead/respawning)
    if (!player.visible) {
        if (player.userData.healthBar) {
            if (player.userData.healthBar.parentNode) {
                player.userData.healthBar.parentNode.removeChild(player.userData.healthBar);
            }
            player.userData.healthBar = null;
        }
        return;
    }
    
    if (!player.userData.healthBar) {
        const healthBar = document.createElement('div');
        healthBar.className = 'player-health-bar';
        healthBar.style.cssText = `
            position: absolute;
            width: 60px;
            height: 6px;
            background: rgba(0, 0, 0, 0.7);
            border: 1px solid #fff;
            border-radius: 3px;
            pointer-events: none;
            z-index: 100;
        `;
        document.body.appendChild(healthBar);
        player.userData.healthBar = healthBar;
    }
    
    const health = player.userData.health || maxHealth;
    const healthPercent = (health / maxHealth) * 100;
    player.userData.healthBar.innerHTML = `
        <div style="
            width: ${healthPercent}%;
            height: 100%;
            background: ${healthPercent > 50 ? '#4a9eff' : healthPercent > 25 ? '#ffd93d' : '#ff6b6b'};
            transition: width 0.3s;
        "></div>
    `;
    
    // Position above player head
    const head = player.userData.head;
    const headWorldPos = new THREE.Vector3();
    head.getWorldPosition(headWorldPos);
    headWorldPos.y += 1.0;
    
    const vector = headWorldPos.project(camera);
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (vector.y * -0.5 + 0.5) * window.innerHeight;
    
    player.userData.healthBar.style.left = x + 'px';
    player.userData.healthBar.style.top = y + 'px';
    player.userData.healthBar.style.transform = 'translate(-50%, -100%)';
}

// Death explosion with wooden cubes (synced across all clients)
function createDeathExplosion(position, cubeData = null) {
    // Play preloaded death sound for instant playback
    if (deathSound) {
        // Reset to beginning and play immediately
        deathSound.currentTime = 0;
        deathSound.play().catch(err => {
            console.log('Could not play death sound:', err.message);
        });
    } else {
        // Fallback if preload failed
        const audio = new Audio('death-sound.mp3');
        audio.volume = 0.7;
        audio.play().catch(err => {
            console.log('Could not play death sound:', err.message);
        });
    }
    
    const cubeCount = 30;
    const cubes = [];
    
    // If cubeData is provided (from server sync), use it; otherwise generate random
    for (let i = 0; i < cubeCount; i++) {
        const size = cubeData ? cubeData[i].size : (0.3 + Math.random() * 0.3); // Doubled size
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshStandardMaterial({ color: 0xd2691e }); // Lighter brown (chocolate color)
        const cube = new THREE.Mesh(geometry, material);
        
        cube.position.copy(position);
        if (cubeData) {
            cube.position.add(cubeData[i].offset);
        } else {
            cube.position.y += Math.random() * 0.3;
        }
        
        // Random velocity with better explosion spread (or use synced data)
        let velocity;
        if (cubeData) {
            // Convert synced velocity object to Vector3
            velocity = new THREE.Vector3(
                cubeData[i].velocity.x,
                cubeData[i].velocity.y,
                cubeData[i].velocity.z
            );
        } else {
            // Generate better explosion pattern
            const angle = (Math.PI * 2 * i) / cubeCount; // Distribute cubes in a circle
            const radius = 0.3 + Math.random() * 0.4;
            const verticalAngle = (Math.random() - 0.3) * Math.PI * 0.4; // Slight upward bias
            
            velocity = new THREE.Vector3(
                Math.cos(angle) * radius * (6 + Math.random() * 4), // Better horizontal spread
                Math.sin(verticalAngle) * (5 + Math.random() * 5) + 3, // More varied vertical velocity
                Math.sin(angle) * radius * (6 + Math.random() * 4)
            );
        }
        
        // Initialize physics properties
        cube.userData.velocity = velocity;
        cube.userData.angularVelocity = new THREE.Vector3(
            (Math.random() - 0.5) * 15, // More spin for better visual effect
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15
        );
        cube.userData.size = size;
        cube.userData.mass = size * size * size; // Mass based on volume
        cube.userData.onGround = false;
        cube.userData.bounce = 0.3; // Bounce coefficient
        cube.userData.friction = 0.8; // Friction coefficient
        cube.castShadow = true;
        scene.add(cube);
        cubes.push(cube);
    }
    
    // Physics simulation with proper physics properties
    const gravity = -20;
    const deltaTime = 0.016; // ~60fps
    let time = 0;
    const despawnTime = 5; // Despawn after 5 seconds
    
    const physicsStep = () => {
        time += deltaTime;
        
        cubes.forEach(cube => {
            // Apply gravity
            cube.userData.velocity.y += gravity * deltaTime;
            
            // Update position based on velocity
            const newPos = cube.position.clone();
            newPos.add(cube.userData.velocity.clone().multiplyScalar(deltaTime));
            
            // Update rotation based on angular velocity
            cube.rotation.x += cube.userData.angularVelocity.x * deltaTime;
            cube.rotation.y += cube.userData.angularVelocity.y * deltaTime;
            cube.rotation.z += cube.userData.angularVelocity.z * deltaTime;
            
            // Apply angular damping (slow down rotation over time)
            cube.userData.angularVelocity.multiplyScalar(0.98);
            
            // Check collision with ground
            const groundY = 0.5; // Ground level (blocks sit at 0.5)
            const cubeBottom = newPos.y - cube.userData.size / 2;
            
            if (cubeBottom <= groundY && cube.userData.velocity.y <= 0) {
                // Collision with ground
                newPos.y = groundY + cube.userData.size / 2;
                
                // Bounce if velocity is significant
                if (Math.abs(cube.userData.velocity.y) > 0.5) {
                    cube.userData.velocity.y *= -cube.userData.bounce;
                    // Add some random angular velocity on bounce
                    cube.userData.angularVelocity.x += (Math.random() - 0.5) * 5;
                    cube.userData.angularVelocity.z += (Math.random() - 0.5) * 5;
                } else {
                    // Stop bouncing, apply friction
                    cube.userData.velocity.y = 0;
                    cube.userData.onGround = true;
                }
                
                // Apply friction when on ground
                if (cube.userData.onGround) {
                    cube.userData.velocity.x *= cube.userData.friction;
                    cube.userData.velocity.z *= cube.userData.friction;
                    // Stop angular velocity when on ground
                    cube.userData.angularVelocity.multiplyScalar(0.9);
                }
            } else {
                cube.userData.onGround = false;
            }
            
            // Check collision with blocks
            const cubeX = Math.round(newPos.x);
            const cubeZ = Math.round(newPos.z);
            
            // Check multiple block positions for better collision
            for (let checkY = Math.floor(cubeBottom); checkY <= Math.ceil(newPos.y + cube.userData.size / 2); checkY++) {
                const blockKey = `${cubeX},${checkY},${cubeZ}`;
                
                if (blocks.has(blockKey)) {
                    const block = blocks.get(blockKey);
                    const blockTop = block.y + 0.5;
                    const blockBottom = block.y - 0.5;
                    
                    // Check if cube is colliding with block
                    if (cubeBottom <= blockTop && newPos.y + cube.userData.size / 2 >= blockBottom && cube.userData.velocity.y <= 0) {
                        // Collision from above
                        newPos.y = blockTop + cube.userData.size / 2;
                        
                        if (Math.abs(cube.userData.velocity.y) > 0.5) {
                            cube.userData.velocity.y *= -cube.userData.bounce;
                            cube.userData.angularVelocity.x += (Math.random() - 0.5) * 5;
                            cube.userData.angularVelocity.z += (Math.random() - 0.5) * 5;
                        } else {
                            cube.userData.velocity.y = 0;
                            cube.userData.onGround = true;
                        }
                        
                        if (cube.userData.onGround) {
                            cube.userData.velocity.x *= cube.userData.friction;
                            cube.userData.velocity.z *= cube.userData.friction;
                            cube.userData.angularVelocity.multiplyScalar(0.9);
                        }
                        break;
                    } else if (newPos.x - cube.userData.size / 2 <= block.x + 0.5 && 
                               newPos.x + cube.userData.size / 2 >= block.x - 0.5 &&
                               newPos.z - cube.userData.size / 2 <= block.z + 0.5 &&
                               newPos.z + cube.userData.size / 2 >= block.z - 0.5) {
                        // Side collision - simple push away
                        const pushDir = new THREE.Vector3(
                            newPos.x - block.x,
                            0,
                            newPos.z - block.z
                        ).normalize();
                        cube.userData.velocity.x += pushDir.x * 2;
                        cube.userData.velocity.z += pushDir.z * 2;
                        cube.userData.angularVelocity.y += (Math.random() - 0.5) * 5;
                    }
                }
            }
            
            // Air resistance
            if (!cube.userData.onGround) {
                cube.userData.velocity.multiplyScalar(0.99);
            }
            
            cube.position.copy(newPos);
        });
        
        if (time < despawnTime) {
            requestAnimationFrame(physicsStep);
        } else {
            // Remove cubes after 5 seconds
            cubes.forEach(cube => {
                scene.remove(cube);
                cube.geometry.dispose();
                cube.material.dispose();
            });
        }
    };
    physicsStep();
}

// Setup login screen
function setupLoginScreen() {
    // Set default selections
    document.querySelector('.color-option[data-color="0x4a9eff"]').classList.add('selected');
    document.querySelector('.hat-option[data-hat="none"]').classList.add('selected');

    // Color picker
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            playerColor = parseInt(option.dataset.color);
        });
    });

    // Hat selector
    document.querySelectorAll('.hat-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.hat-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            playerHat = option.dataset.hat;
        });
    });

    // Start game button
    document.getElementById('start-game-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('player-name');
        const name = nameInput.value.trim() || 'Player';
        
        if (name.length > 0) {
            playerName = name;
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('game-container').style.display = 'block';
            
            // Create local player with customization
            localPlayer = createStickman(playerColor, playerHat);
            localPlayer.position.set(0, 5, 0);
            localPlayer.userData.isMoving = false;
            localPlayer.userData.name = playerName;
            scene.add(localPlayer);
            createNameLabel(localPlayer);
            
            // Attach hat if specified
            if (localPlayer.userData.hatType && localPlayer.userData.hatType !== 'none') {
                const hatMesh = createHat(localPlayer.userData.hatType, null);
                attachHatToHead(localPlayer, hatMesh);
            }

            // Initialize build mode UI
            updateBuildModeUI();

            // Connect to server
            connectToServer();
        } else {
            alert('Please enter a name!');
        }
    });

    // Allow Enter key to start game
    document.getElementById('player-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('start-game-btn').click();
        }
    });
}

// Setup pause menu (UI only - game continues running in multiplayer)
function setupPauseMenu() {
    // Create pause menu container
    const pauseMenu = document.createElement('div');
    pauseMenu.id = 'pause-menu';
    pauseMenu.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    // Create menu panel
    const menuPanel = document.createElement('div');
    menuPanel.style.cssText = `
        background: rgba(255, 255, 255, 0.95);
        padding: 40px;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        min-width: 400px;
        max-width: 600px;
        width: 90%;
    `;
    
    // Title
    const title = document.createElement('h2');
    title.textContent = 'Menu';
    title.style.cssText = `
        text-align: center;
        color: #333;
        margin-bottom: 30px;
        font-size: 32px;
    `;
    menuPanel.appendChild(title);
    
    // Tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.style.cssText = `
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
        border-bottom: 2px solid #ddd;
    `;
    
    // Tab buttons
    const settingsTab = document.createElement('button');
    settingsTab.textContent = 'Settings';
    settingsTab.className = 'pause-tab active';
    settingsTab.style.cssText = `
        flex: 1;
        padding: 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        color: #667eea;
        border-bottom: 3px solid #667eea;
        transition: all 0.2s;
    `;
    
    const menuTab = document.createElement('button');
    menuTab.textContent = 'Return to Menu';
    menuTab.className = 'pause-tab';
    menuTab.style.cssText = `
        flex: 1;
        padding: 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        color: #666;
        border-bottom: 3px solid transparent;
        transition: all 0.2s;
    `;
    
    const resetTab = document.createElement('button');
    resetTab.textContent = 'Reset';
    resetTab.className = 'pause-tab';
    resetTab.style.cssText = `
        flex: 1;
        padding: 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        color: #666;
        border-bottom: 3px solid transparent;
        transition: all 0.2s;
    `;
    
    tabsContainer.appendChild(settingsTab);
    tabsContainer.appendChild(menuTab);
    tabsContainer.appendChild(resetTab);
    menuPanel.appendChild(tabsContainer);
    
    // Content container
    const contentContainer = document.createElement('div');
    contentContainer.id = 'pause-content';
    contentContainer.style.cssText = `
        min-height: 200px;
    `;
    
    // Settings content
    const settingsContent = document.createElement('div');
    settingsContent.id = 'settings-content';
    settingsContent.style.cssText = `
        display: block;
    `;
    
    const volumeLabel = document.createElement('label');
    volumeLabel.textContent = 'Master Volume';
    volumeLabel.style.cssText = `
        display: block;
        margin-bottom: 10px;
        color: #333;
        font-weight: bold;
        font-size: 14px;
    `;
    settingsContent.appendChild(volumeLabel);
    
    const volumeContainer = document.createElement('div');
    volumeContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 15px;
        margin-bottom: 20px;
    `;
    
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '100';
    volumeSlider.value = '100';
    volumeSlider.style.cssText = `
        flex: 1;
        height: 8px;
    `;
    
    const volumeValue = document.createElement('span');
    volumeValue.textContent = '100%';
    volumeValue.style.cssText = `
        min-width: 50px;
        text-align: right;
        color: #333;
        font-weight: bold;
    `;
    
    volumeSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        volumeValue.textContent = value + '%';
        masterVolume = value / 100;
        updateVolume();
    });
    
    volumeContainer.appendChild(volumeSlider);
    volumeContainer.appendChild(volumeValue);
    settingsContent.appendChild(volumeContainer);
    
    // Menu content
    const menuContent = document.createElement('div');
    menuContent.id = 'menu-content';
    menuContent.style.cssText = `
        display: none;
        text-align: center;
    `;
    
    const menuText = document.createElement('p');
    menuText.textContent = 'Return to the character creation screen?';
    menuText.style.cssText = `
        color: #333;
        margin-bottom: 20px;
        font-size: 16px;
    `;
    menuContent.appendChild(menuText);
    
    const returnButton = document.createElement('button');
    returnButton.textContent = 'Return to Menu';
    returnButton.style.cssText = `
        padding: 12px 30px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.2s;
    `;
    returnButton.addEventListener('mouseenter', () => {
        returnButton.style.background = '#5568d3';
    });
    returnButton.addEventListener('mouseleave', () => {
        returnButton.style.background = '#667eea';
    });
    returnButton.addEventListener('click', () => {
        returnToMenu();
    });
    menuContent.appendChild(returnButton);
    
    // Reset content
    const resetContent = document.createElement('div');
    resetContent.id = 'reset-content';
    resetContent.style.cssText = `
        display: none;
        text-align: center;
    `;
    
    const resetText = document.createElement('p');
    resetText.textContent = 'Kill yourself and respawn?';
    resetText.style.cssText = `
        color: #333;
        margin-bottom: 20px;
        font-size: 16px;
    `;
    resetContent.appendChild(resetText);
    
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset (Kill Player)';
    resetButton.style.cssText = `
        padding: 12px 30px;
        background: #ff6b6b;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.2s;
    `;
    resetButton.addEventListener('mouseenter', () => {
        resetButton.style.background = '#ee5a5a';
    });
    resetButton.addEventListener('mouseleave', () => {
        resetButton.style.background = '#ff6b6b';
    });
    resetButton.addEventListener('click', () => {
        killPlayer();
        togglePauseMenu();
    });
    resetContent.appendChild(resetButton);
    
    contentContainer.appendChild(settingsContent);
    contentContainer.appendChild(menuContent);
    contentContainer.appendChild(resetContent);
    menuPanel.appendChild(contentContainer);
    
    pauseMenu.appendChild(menuPanel);
    document.body.appendChild(pauseMenu);
    
    // Tab switching
    const tabs = [settingsTab, menuTab, resetTab];
    const contents = [settingsContent, menuContent, resetContent];
    
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            // Update tab styles
            tabs.forEach(t => {
                t.style.color = '#666';
                t.style.borderBottomColor = 'transparent';
                t.classList.remove('active');
            });
            tab.style.color = '#667eea';
            tab.style.borderBottomColor = '#667eea';
            tab.classList.add('active');
            
            // Update content visibility
            contents.forEach(c => c.style.display = 'none');
            contents[index].style.display = 'block';
        });
    });
}

// Toggle pause menu (UI only - game continues running)
function togglePauseMenu() {
    pauseMenuOpen = !pauseMenuOpen;
    const pauseMenu = document.getElementById('pause-menu');
    
    if (pauseMenuOpen) {
        pauseMenu.style.display = 'flex';
        // Exit pointer lock if active
        if (document.pointerLockElement) {
            document.exitPointerLock();
            cameraLocked = false;
        }
    } else {
        pauseMenu.style.display = 'none';
    }
}

// Update volume for all sounds
function updateVolume() {
    if (deathSound) deathSound.volume = 0.7 * masterVolume;
    if (metalHitSound) metalHitSound.volume = 0.5 * masterVolume;
    if (ragdollSound) ragdollSound.volume = 0.6 * masterVolume;
}

// Return to menu
function returnToMenu() {
    // Close pause menu
    togglePauseMenu();
    
    // Disconnect from server
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    // Hide game container
    document.getElementById('game-container').style.display = 'none';
    
    // Show login screen
    document.getElementById('login-screen').style.display = 'flex';
    
    // Clean up game state
    if (localPlayer) {
        scene.remove(localPlayer);
        localPlayer = null;
    }
    otherPlayers.clear();
    blocks.clear();
    playerHealth = maxHealth;
}

// Kill player (reset)
function killPlayer() {
    if (!localPlayer || !socket) return;
    
    // Set health to 0 and notify server
    playerHealth = 0;
    if (socket) {
        socket.emit('playerDamage', {
            targetId: socket.id,
            damage: 1000 // Massive damage to ensure death
        });
    }
}

// Connect to server
function connectToServer() {
    // Automatically connect to the same host (works for both local and deployed)
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');
        // Send player customization data
        socket.emit('playerCustomization', {
            name: playerName,
            color: playerColor,
            hat: playerHat
        });
    });

    socket.on('gameState', (data) => {
        // Add other players
        data.players.forEach(playerData => {
            if (playerData.id !== socket.id) {
                addOtherPlayer(playerData);
            }
        });

        // Add existing blocks
        data.blocks.forEach(blockData => {
            addBlock(blockData.x, blockData.y, blockData.z, blockData.type);
        });
    });

    socket.on('playerJoined', (playerData) => {
        addOtherPlayer(playerData);
        updatePlayerCount();
    });

    socket.on('playerMoved', (data) => {
        const player = otherPlayers.get(data.id);
        if (player) {
            const oldPos = player.position.clone();
            player.position.set(data.position.x, data.position.y, data.position.z);
            player.rotation.y = data.rotation.y;
            // Head no longer rotates with camera - keep it fixed
            // Check if player is moving
            const distance = oldPos.distanceTo(player.position);
            player.userData.isMoving = distance > 0.01;
            // Sync sprint state for animation
            player.userData.isSprinting = data.isSprinting || false;
        }
    });

    socket.on('playerLeft', (playerId) => {
        const player = otherPlayers.get(playerId);
        if (player) {
            scene.remove(player);
            if (player.userData.speechBubble) {
                document.body.removeChild(player.userData.speechBubble);
            }
            if (player.userData.nameLabel) {
                document.body.removeChild(player.userData.nameLabel);
            }
            otherPlayers.delete(playerId);
            updatePlayerCount();
        }
    });

    socket.on('chatMessage', (data) => {
        displayChatMessage(data);
    });

    socket.on('blockPlaced', (blockData) => {
        addBlock(blockData.x, blockData.y, blockData.z, blockData.type);
    });

    socket.on('blockRemoved', (data) => {
        removeBlock(data.x, data.y, data.z);
    });

    socket.on('playerDamaged', (data) => {
        if (data.playerId === socket.id) {
            // Local player took damage
            playerHealth = Math.max(0, playerHealth - data.damage);
            updateHealthBar();
        } else {
            // Other player took damage
            const player = otherPlayers.get(data.playerId);
            if (player) {
                player.userData.health = Math.max(0, (player.userData.health || maxHealth) - data.damage);
                updateHealthBar();
            }
        }
    });

    socket.on('playerDied', (data) => {
        const deathPos = data.deathPosition ? 
            new THREE.Vector3(data.deathPosition.x, data.deathPosition.y, data.deathPosition.z) :
            (data.playerId === socket.id ? localPlayer.position.clone() : otherPlayers.get(data.playerId)?.position.clone());
        
        if (!deathPos) return;
        
        // Convert cubeData to Vector3 format if present
        const cubeData = data.cubeData ? data.cubeData.map(cube => ({
            size: cube.size,
            offset: new THREE.Vector3(cube.offset.x, cube.offset.y, cube.offset.z),
            velocity: new THREE.Vector3(cube.velocity.x, cube.velocity.y, cube.velocity.z)
        })) : null;
        
        createDeathExplosion(deathPos, cubeData);
        
        if (data.playerId === socket.id) {
            // Local player died
            playerHealth = maxHealth;
            
            // Hide player during respawn
            localPlayer.visible = false;
            // Hide health bar
            updateHealthBar();
        } else {
            // Other player died
            const player = otherPlayers.get(data.playerId);
            if (player) {
                player.userData.health = maxHealth;
                
                // Hide player during respawn
                player.visible = false;
                // Remove health bar
                if (player.userData.healthBar) {
                    if (player.userData.healthBar.parentNode) {
                        player.userData.healthBar.parentNode.removeChild(player.userData.healthBar);
                    }
                    player.userData.healthBar = null;
                }
            }
        }
    });

    socket.on('playerRespawned', (data) => {
        if (data.playerId === socket.id) {
            // Local player respawned
            localPlayer.position.set(data.position.x, data.position.y, data.position.z);
            localPlayer.visible = true;
        } else {
            // Other player respawned
            const player = otherPlayers.get(data.playerId);
            if (player) {
                player.position.set(data.position.x, data.position.y, data.position.z);
                player.visible = true;
            }
        }
    });

    socket.on('playerHealthUpdate', (data) => {
        if (data.playerId === socket.id) {
            playerHealth = data.health;
            updateHealthBar();
        } else {
            const player = otherPlayers.get(data.playerId);
            if (player) {
                player.userData.health = data.health;
                updateHealthBar();
            }
        }
    });

    socket.on('playerEquippedItem', (data) => {
        const player = otherPlayers.get(data.playerId);
        if (player) {
            player.userData.equippedItem = data.item;
            createItemInHand(player, data.item);
        }
    });

    // Handle other player arm swing
    socket.on('playerSwungArm', (data) => {
        const player = otherPlayers.get(data.playerId);
        if (player) {
            swingArm(player);
        }
    });
    
    // Handle baseball bat hit - launch player and trigger ragdoll
    socket.on('playerBatHit', (data) => {
        if (data.targetId === socket.id) {
            // Local player was hit - launch forward approximately 10 blocks
            const launchDir = new THREE.Vector3(data.launchDirection.x, data.launchDirection.y, data.launchDirection.z);
            triggerRagdoll(localPlayer, launchDir);
        } else {
            // Other player was hit
            const player = otherPlayers.get(data.targetId);
            if (player) {
                const launchDir = new THREE.Vector3(data.launchDirection.x, data.launchDirection.y, data.launchDirection.z);
                // Use synced angular velocities if provided for consistent ragdoll animation
                const syncAngVel = data.angularVelocities || null;
                triggerRagdoll(player, launchDir, syncAngVel);
                // Velocity will be applied continuously in updateRagdoll
            }
        }
        // Play ragdoll sound for all players
        if (ragdollSound) {
            ragdollSound.play().catch(err => {
                console.log('Could not play ragdoll sound:', err);
            });
        }
    });
    
    // Handle ragdoll angular velocities sync (for consistent ragdoll animation across clients)
    socket.on('playerRagdollAngularVelocities', (data) => {
        const player = otherPlayers.get(data.playerId);
        if (player && player.userData.isRagdoll && data.angularVelocities) {
            // Update ragdoll state to match the synced ones for consistent animation
            if (data.angularVelocities.torso) {
                // Convert old format to new ragdollState format
                if (!player.userData.ragdollState) {
                    player.userData.ragdollState = {
                        torsoAngVel: data.angularVelocities.torso,
                        leftArmAngVel: data.angularVelocities.leftArm || { x: 0, z: 0 },
                        rightArmAngVel: data.angularVelocities.rightArm || { x: 0, z: 0 },
                        leftLegAngVel: data.angularVelocities.leftLeg || { x: 0, z: 0 },
                        rightLegAngVel: data.angularVelocities.rightLeg || { x: 0, z: 0 }
                    };
                } else {
                    // Update existing state
                    player.userData.ragdollState.torsoAngVel = data.angularVelocities.torso;
                    if (data.angularVelocities.leftArm) player.userData.ragdollState.leftArmAngVel = data.angularVelocities.leftArm;
                    if (data.angularVelocities.rightArm) player.userData.ragdollState.rightArmAngVel = data.angularVelocities.rightArm;
                    if (data.angularVelocities.leftLeg) player.userData.ragdollState.leftLegAngVel = data.angularVelocities.leftLeg;
                    if (data.angularVelocities.rightLeg) player.userData.ragdollState.rightLegAngVel = data.angularVelocities.rightLeg;
                }
            }
        }
    });
    
    // Handle ragdoll state sync
    socket.on('playerRagdoll', (data) => {
        if (data.playerId === socket.id) {
            // Local player ragdoll (already handled)
            return;
        }
        const player = otherPlayers.get(data.playerId);
        if (player) {
            // Use synced angular velocities if provided for consistent ragdoll animation
            triggerRagdoll(player, new THREE.Vector3(0, 0, 0), data.angularVelocities || null);
        }
    });

    // Handle typing indicator
    socket.on('playerTyping', (data) => {
        const player = otherPlayers.get(data.playerId);
        if (player) {
            if (data.isTyping) {
                showTypingIndicator(player);
            } else {
                hideTypingIndicator(player);
            }
        }
    });
}

function addOtherPlayer(playerData) {
    const player = createStickman(playerData.color || 0xffffff, playerData.hat || 'none');
    player.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
    player.rotation.y = playerData.rotation.y || 0;
    // Head no longer rotates with camera - keep it fixed
    
    // Attach hat if specified
    if (player.userData.hatType && player.userData.hatType !== 'none') {
        const hatMesh = createHat(player.userData.hatType, null);
        attachHatToHead(player, hatMesh);
    }
    player.userData.name = playerData.name || 'Player';
    player.userData.isMoving = false;
    player.userData.health = playerData.health || maxHealth;
    // Sync equipped item if player has one
    if (playerData.equippedItem) {
        player.userData.equippedItem = playerData.equippedItem;
        createItemInHand(player, playerData.equippedItem);
    }
    scene.add(player);
    otherPlayers.set(playerData.id, player);
    createNameLabel(player);
    updatePlayerCount();
    updateHealthBar();
}

function updatePlayerCount() {
    document.getElementById('score').textContent = `Players: ${otherPlayers.size + 1}`;
}

function placeBlock(x, y, z, type) {
    if (socket) {
        socket.emit('placeBlock', { x, y, z, type });
    }
    addBlock(x, y, z, type);
}

function addBlock(x, y, z, type) {
    const blockKey = `${x},${y},${z}`;
    if (!blocks.has(blockKey)) {
        const block = createBlock(x, y, z, type);
        scene.add(block);
        blocks.set(blockKey, block);
    }
}

function removeBlock(x, y, z) {
    const blockKey = `${x},${y},${z}`;
    const block = blocks.get(blockKey);
    if (block) {
        scene.remove(block);
        blocks.delete(blockKey);
    }
}

// Update player movement
function updatePlayerMovement(delta) {
    if (!localPlayer) return;

    // Store intended movement direction for rotation (before collisions modify velocity)
    let intendedDirection = null;

    // Skip movement controls if ragdoll is active, but still apply physics and collision
    if (!isRagdoll) {
        // Base speed increased by 30% (100 * 1.3 = 130)
        const baseSpeed = 130;
        // Sprint doubles speed (130 * 2.0 = 260)
        const speed = moveState.sprint ? baseSpeed * 2.0 : baseSpeed;
    const direction = new THREE.Vector3();

    // Calculate movement direction based on camera angle
    if (moveState.forward) direction.z -= 1;
    if (moveState.backward) direction.z += 1;
    if (moveState.left) direction.x -= 1;
    if (moveState.right) direction.x += 1;

    direction.normalize();
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngle);

    // Store intended movement direction for rotation (before collisions modify velocity)
    intendedDirection = direction.clone();

    // Apply movement
    velocity.x = direction.x * speed * delta;
    velocity.z = direction.z * speed * delta;

        // Apply gravity when not in ragdoll (ragdoll handles its own gravity)
    velocity.y -= 30 * delta; // Gravity
    }
    // Note: Gravity during ragdoll is handled in updateRagdoll function

    // Store old position for collision detection
    const oldPos = localPlayer.position.clone();
    
    // Track when player leaves ground for fall detection
    const wasOnGround = localPlayer.position.y <= lastGroundY + 0.5;

    // Update position
    localPlayer.position.x += velocity.x * delta;
    localPlayer.position.z += velocity.z * delta;
    localPlayer.position.y += velocity.y * delta;

    // If player was on ground and is now falling, store the ground Y
    if (wasOnGround && velocity.y < 0 && !isRagdoll) {
        // Player just started falling, store current ground Y
        if (lastGroundY === 0 || localPlayer.position.y > lastGroundY) {
            lastGroundY = localPlayer.position.y;
        }
    }

    // Improved collision detection with blocks - allows jumping onto blocks
    const playerRadius = 0.25; // Player radius
    const playerHeight = 1.8; // Player height
    // Player bottom is at center - 0.3 (hip at +0.5, legs extend down 0.8 total)
    const playerBottom = localPlayer.position.y - 0.3; // Bottom of player (feet)
    const playerTop = localPlayer.position.y + 1.35; // Top of player (head at 1.35)
    
    // Check collisions with blocks
    let onGround = false;
    for (const [key, block] of blocks.entries()) {
        const blockPos = block.position;
        // Block center is at y + 0.5 (since we add 0.5 in createBlock), so it extends from y to y + 1
        const gridY = block.userData.gridY !== undefined ? block.userData.gridY : Math.round(blockPos.y - 0.5);
        const blockMin = new THREE.Vector3(blockPos.x - 0.5, gridY, blockPos.z - 0.5);
        const blockMax = new THREE.Vector3(blockPos.x + 0.5, gridY + 1, blockPos.z + 0.5);
        
        // Check horizontal overlap
        const horizontalOverlap = (localPlayer.position.x + playerRadius > blockMin.x &&
            localPlayer.position.x - playerRadius < blockMax.x &&
            localPlayer.position.z + playerRadius > blockMin.z &&
            localPlayer.position.z - playerRadius < blockMax.z);
        
        if (horizontalOverlap) {
            // Check if player is on top of block (landing/jumping onto)
            const blockTop = blockMax.y;
            const feetY = localPlayer.position.y - 0.3; // Feet position
            const headY = localPlayer.position.y + 1.35; // Head position
            
            // Landing on top of block (from above or jumping up)
            if (feetY <= blockTop + 0.1 && feetY >= blockTop - 0.3 && velocity.y <= 0) {
                // Check if there's a block above this one - prevent wall-hopping
                const blockX = Math.round(blockPos.x);
                const blockZ = Math.round(blockPos.z);
                const blockAboveY = gridY + 1;
                const blockAboveKey = `${blockX},${blockAboveY},${blockZ}`;
                
                // Only allow landing if there's no block directly above
                if (!blocks.has(blockAboveKey)) {
                    // Check fall distance for ragdoll trigger (>10 blocks = 10 units)
                    const fallDistance = lastGroundY - (blockTop + 0.27);
                    if (fallDistance > 10 && !isRagdoll && lastGroundY > 0) {
                        // Trigger ragdoll from fall
                        triggerRagdoll(localPlayer, new THREE.Vector3(0, 0, 0));
                        if (socket) {
                            socket.emit('playerRagdoll', { 
                                reason: 'fall',
                                fallDistance: fallDistance
                            });
                        }
                    }
                    
                    localPlayer.position.y = blockTop + 0.27; // Player center = block top + 0.27 (feet on block, lowered by 0.03)
                    velocity.y = 0;
                    canJump = true;
                    onGround = true;
                    lastGroundY = blockTop + 0.27; // Update last ground Y when landing
                }
            }
            // Hitting ceiling of block
            else if (headY >= blockMin.y - 0.1 && headY <= blockMin.y + 0.3 && velocity.y > 0) {
                localPlayer.position.y = blockMin.y - 1.35; // Player center = block bottom - 1.35
                velocity.y = 0;
            }
            // Side collision - push player away horizontally using proper AABB (rectangular) collision
            else if (headY > blockMin.y && feetY < blockMax.y) {
                // Use proper AABB collision detection (rectangular, not cylindrical)
                // Check if player is actually overlapping with block's rectangular bounds
                const playerMinX = localPlayer.position.x - playerRadius;
                const playerMaxX = localPlayer.position.x + playerRadius;
                const playerMinZ = localPlayer.position.z - playerRadius;
                const playerMaxZ = localPlayer.position.z + playerRadius;
                
                // Check for actual overlap in X and Z axes separately
                const overlapX = Math.min(playerMaxX - blockMin.x, blockMax.x - playerMinX);
                const overlapZ = Math.min(playerMaxZ - blockMin.z, blockMax.z - playerMinZ);
                
                // Only push if there's actual overlap (both X and Z overlap)
                if (overlapX > 0 && overlapZ > 0) {
                    // Determine which axis has the smallest overlap (push in that direction)
                    let pushX = 0;
                    let pushZ = 0;
                    
                    if (overlapX < overlapZ) {
                        // Push in X direction (smaller overlap)
                        if (localPlayer.position.x < blockPos.x) {
                            // Player is to the left, push left
                            pushX = -(overlapX + 0.01); // Small extra push to prevent re-collision
                        } else {
                            // Player is to the right, push right
                            pushX = overlapX + 0.01;
                        }
                    } else {
                        // Push in Z direction (smaller overlap)
                        if (localPlayer.position.z < blockPos.z) {
                            // Player is in front, push forward
                            pushZ = -(overlapZ + 0.01);
                        } else {
                            // Player is behind, push backward
                            pushZ = overlapZ + 0.01;
                        }
                    }
                    
                    // Apply the push
                    localPlayer.position.x += pushX;
                    localPlayer.position.z += pushZ;
                    
                    // Calculate wall normal based on push direction
                    const pushLength = Math.sqrt(pushX * pushX + pushZ * pushZ);
                    if (pushLength > 0.01) {
                        const wallNormal = new THREE.Vector3(pushX / pushLength, 0, pushZ / pushLength);
                        
                        // Project velocity onto wall normal to get perpendicular component
                        const dotProduct = velocity.x * wallNormal.x + velocity.z * wallNormal.z;
                        const perpVelocityX = wallNormal.x * dotProduct;
                        const perpVelocityZ = wallNormal.z * dotProduct;
                        
                        // Remove perpendicular component (bounce off wall), keep parallel component (slide along wall)
                        velocity.x -= perpVelocityX * 1.2; // Slight bounce
                        velocity.z -= perpVelocityZ * 1.2;
                        
                        // Clamp velocity to prevent sticking
                        if (Math.abs(velocity.x) < 0.01) velocity.x = 0;
                        if (Math.abs(velocity.z) < 0.01) velocity.z = 0;
                    }
                }
            }
        }
    }
    
    // Ground collision (only if not on a block)
    // Player bottom is at center - 0.3, so for feet at y=0, center should be at y=0.3
    // But players are floating 0.2, so adjust: feet at y=0 means center at y=0.3, but we need center at y=0.1 for feet at y=0
    // Actually, if player bottom is at center - 0.3, and we want feet at y=0, center should be at y=0.3
    // But user says players float 0.2, so maybe the calculation is wrong. Let's check: if center is at 0.3, bottom is at 0.0, that's correct.
    // The issue might be that groundLevel is 0.3 but should be 0.1 (0.3 - 0.2 float)
    if (!onGround && localPlayer.position.y < 0.27) {
        // Check fall distance for ragdoll trigger (>10 blocks = 10 units)
        const fallDistance = lastGroundY - 0.27;
        if (fallDistance > 10 && !isRagdoll && lastGroundY > 0) {
            // Trigger ragdoll from fall
            triggerRagdoll(localPlayer, new THREE.Vector3(0, 0, 0));
            if (socket) {
                socket.emit('playerRagdoll', { 
                    reason: 'fall',
                    fallDistance: fallDistance
                });
            }
        }
        
        localPlayer.position.y = 0.27; // Feet on ground (y=0, center at 0.27 since bottom is center - 0.3, lowered by 0.03)
        velocity.y = 0;
        canJump = true;
        lastGroundY = 0.27; // Update last ground Y when landing
    } else if (onGround) {
        // Update last ground Y when on a block (store highest ground position)
        const currentGroundY = localPlayer.position.y - 0.3;
        if (currentGroundY > lastGroundY) {
            lastGroundY = currentGroundY;
        }
    }

    // Player-to-player collision detection
    const playerCollisionRadius = 0.25; // Player radius
    for (const [otherPlayerId, otherPlayer] of otherPlayers.entries()) {
        if (!otherPlayer.visible) continue; // Skip invisible players
        
        const otherPos = otherPlayer.position;
        const localPos = localPlayer.position;
        const distance = Math.sqrt(
            Math.pow(localPos.x - otherPos.x, 2) + 
            Math.pow(localPos.z - otherPos.z, 2)
        );
        
        // Check if players are overlapping horizontally
        const minDistance = playerCollisionRadius * 2; // Two player radii
        if (distance < minDistance && distance > 0.01) {
            // Push players apart
            const pushDirection = new THREE.Vector3(
                localPos.x - otherPos.x,
                0,
                localPos.z - otherPos.z
            ).normalize();
            
            // Push local player away from other player
            const overlap = minDistance - distance;
            const pushAmount = overlap * 0.5; // Push half the overlap distance
            
            localPlayer.position.x += pushDirection.x * pushAmount;
            localPlayer.position.z += pushDirection.z * pushAmount;
            
            // Reduce velocity when colliding (unless in ragdoll)
            if (!isRagdoll) {
                velocity.x *= 0.5;
                velocity.z *= 0.5;
            }
        }
    }

    // Rotate player based on camera when locked, otherwise face movement direction
    if (cameraLocked) {
        // When camera is locked, player rotates to face where camera is pointing (not backwards)
        // Camera angle points behind player, so add PI to face forward
        const targetAngle = cameraAngle + Math.PI; // Face where camera is pointing
        let currentAngle = localPlayer.rotation.y;
        let angleDiff = targetAngle - currentAngle;
        
        // Normalize angle difference to [-PI, PI]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Smooth rotation to match camera
        localPlayer.rotation.y = currentAngle + angleDiff * 0.2; // Faster rotation when locked
        localPlayer.userData.isMoving = !isRagdoll && (intendedDirection !== null && intendedDirection.length() > 0.01);
    } else {
        // Normal behavior - rotate to face movement direction
        const rotationDirection = intendedDirection || new THREE.Vector3(velocity.x, 0, velocity.z);
        const isMoving = !isRagdoll && rotationDirection.length() > 0.01;
        localPlayer.userData.isMoving = isMoving;
        if (isMoving) {
            const targetAngle = Math.atan2(rotationDirection.x, rotationDirection.z);
            // Handle angle wrapping to prevent 360 degree turns
            let currentAngle = localPlayer.rotation.y;
            let angleDiff = targetAngle - currentAngle;
            
            // Normalize angle difference to [-PI, PI]
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Smooth rotation using lerp on the normalized difference
            localPlayer.rotation.y = currentAngle + angleDiff * 0.15;
        }
    }

    // Head should not rotate with camera - keep it fixed
    // (Removed head rotation that followed camera)

    // Send position to server
    if (socket && localPlayer) {
        socket.emit('playerMove', {
            position: {
                x: localPlayer.position.x,
                y: localPlayer.position.y,
                z: localPlayer.position.z
            },
            rotation: {
                x: localPlayer.rotation.x,
                y: localPlayer.rotation.y,
                z: localPlayer.rotation.z
            },
            headRotation: {
                x: 0,
                y: 0,
                z: 0
            },
            isSprinting: moveState.sprint // Send sprint state for animation sync
        });
    }
}

// Update third-person camera
function updateCamera() {
    if (!localPlayer) return;

    const playerPos = localPlayer.position.clone();
    
    // Calculate camera position behind player with pitch
    const horizontalDistance = cameraDistance * Math.cos(cameraPitch);
    const verticalOffset = cameraHeight + cameraDistance * Math.sin(cameraPitch);
    
    // Base camera offset
    const cameraOffset = new THREE.Vector3(
        Math.sin(cameraAngle) * horizontalDistance,
        verticalOffset,
        Math.cos(cameraAngle) * horizontalDistance
    );

    const targetPos = playerPos.clone().add(cameraOffset);
    camera.position.lerp(targetPos, 0.1);

    // Look at player (with slight height offset)
    const lookAtPos = playerPos.clone();
    lookAtPos.y += 1.5;
    camera.lookAt(lookAtPos);
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    let delta = (time - prevTime) / 1000;
    prevTime = time;
    
    // Cap delta to prevent huge jumps when tab becomes active (max 0.1 seconds)
    // This fixes the issue where inactive tabs cause noclip and position desync
    delta = Math.min(delta, 0.1);

    // Update player movement
    updatePlayerMovement(delta);

    // Update camera
    updateCamera();

    // Update animations
    if (localPlayer) {
        animateStickman(localPlayer, delta);
        updateSpeechBubblePosition(localPlayer);
        updateNameLabelPosition(localPlayer);
    }
    otherPlayers.forEach(player => {
        animateStickman(player, delta);
        updateSpeechBubblePosition(player);
        updateNameLabelPosition(player);
        if (player.userData.typingBubble) {
            updateTypingBubblePosition(player);
        }
        // Only update health bar if player is visible and has less than max health
        if (player.visible && player.userData.health < maxHealth) {
            updatePlayerHealthBar(player);
        }
    });

    // Render with pixelation effect
    if (pixelRenderTarget) {
        // Render scene to low-res render target
        renderer.setRenderTarget(pixelRenderTarget);
        renderer.render(scene, camera);
        
        // Render the pixelated texture to screen
        renderer.setRenderTarget(null);
        renderer.render(pixelScene, pixelCamera);
    } else {
        // Fallback: render normally
        renderer.render(scene, camera);
    }
}

// Start game
init();


