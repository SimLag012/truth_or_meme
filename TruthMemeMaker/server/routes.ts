import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertUserSchema, insertRoomSchema, insertGameSubmissionSchema, insertGameVoteSchema } from "@shared/schema";

// WebSocket connection management
const roomConnections = new Map<string, Set<WebSocket>>();
const userConnections = new Map<number, WebSocket>();

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Set up WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'join_room') {
          const { roomId, userId } = data;
          
          // Add user to room connections
          if (!roomConnections.has(roomId)) {
            roomConnections.set(roomId, new Set());
          }
          roomConnections.get(roomId)!.add(ws);
          userConnections.set(userId, ws);
          
          // Broadcast user joined to room
          broadcastToRoom(roomId, {
            type: 'user_joined',
            userId
          });
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      // Clean up connections
      for (const [roomId, connections] of roomConnections.entries()) {
        connections.delete(ws);
        if (connections.size === 0) {
          roomConnections.delete(roomId);
        }
      }
      
      for (const [userId, connection] of userConnections.entries()) {
        if (connection === ws) {
          userConnections.delete(userId);
          break;
        }
      }
    });
  });

  // Broadcast message to all users in a room
  function broadcastToRoom(roomId: string, message: any) {
    const connections = roomConnections.get(roomId);
    if (connections) {
      const messageStr = JSON.stringify(message);
      connections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      });
    }
  }

  // User routes
  app.post("/api/users", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already taken" });
      }
      
      const user = await storage.createUser(userData);
      res.json(user);
    } catch (error) {
      res.status(400).json({ error: "Invalid user data" });
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Room routes
  app.post("/api/rooms", async (req, res) => {
    try {
      const roomData = insertRoomSchema.parse(req.body);
      const { hostId } = req.body;
      
      if (!hostId) {
        return res.status(400).json({ error: "Host ID is required" });
      }
      
      const room = await storage.createRoom(roomData, hostId);
      
      // Auto-join the host to the room
      await storage.joinRoom({
        roomId: room.id,
        userId: hostId
      });
      
      res.json(room);
    } catch (error) {
      res.status(400).json({ error: "Invalid room data" });
    }
  });

  app.get("/api/rooms/:id", async (req, res) => {
    try {
      const roomId = req.params.id;
      const room = await storage.getRoom(roomId);
      
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }
      
      const players = await storage.getRoomPlayers(roomId);
      
      res.json({
        ...room,
        players
      });
    } catch (error) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/api/rooms/:id/join", async (req, res) => {
    try {
      const roomId = req.params.id;
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      
      const room = await storage.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }
      
      if (room.status !== "waiting") {
        return res.status(400).json({ error: "Game already in progress" });
      }
      
      const roomPlayer = await storage.joinRoom({
        roomId,
        userId
      });
      
      // Broadcast to room that user joined
      broadcastToRoom(roomId, {
        type: 'player_joined',
        player: roomPlayer
      });
      
      res.json(roomPlayer);
    } catch (error) {
      res.status(400).json({ error: "Failed to join room" });
    }
  });

  app.post("/api/rooms/:id/start", async (req, res) => {
    try {
      const roomId = req.params.id;
      const { hostId } = req.body;
      
      const room = await storage.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }
      
      if (room.hostId !== hostId) {
        return res.status(403).json({ error: "Only host can start the game" });
      }
      
      const players = await storage.getRoomPlayers(roomId);
      if (players.length < 2) {
        return res.status(400).json({ error: "Need at least 2 players to start" });
      }
      
      // Start the game - set first player as current
      const updatedRoom = await storage.updateRoom(roomId, {
        status: "playing",
        currentPlayerId: players[0].userId
      });
      
      // Broadcast game started
      broadcastToRoom(roomId, {
        type: 'game_started',
        currentPlayerId: players[0].userId
      });
      
      res.json(updatedRoom);
    } catch (error) {
      res.status(500).json({ error: "Failed to start game" });
    }
  });

  // Game submission routes
  app.post("/api/submissions", async (req, res) => {
    try {
      const submissionData = insertGameSubmissionSchema.parse(req.body);
      
      const room = await storage.getRoom(submissionData.roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }
      
      if (room.currentPlayerId !== submissionData.playerId) {
        return res.status(400).json({ error: "Not your turn" });
      }
      
      const submission = await storage.createSubmission(submissionData);
      
      // Broadcast submission to room for voting
      broadcastToRoom(submissionData.roomId, {
        type: 'new_submission',
        submission: {
          id: submission.id,
          phrase: submission.phrase,
          round: submission.round,
          playerId: submission.playerId
        }
      });
      
      res.json(submission);
    } catch (error) {
      res.status(400).json({ error: "Invalid submission data" });
    }
  });

  // Game vote routes
  app.post("/api/votes", async (req, res) => {
    try {
      const voteData = insertGameVoteSchema.parse(req.body);
      
      // Check if user already voted
      const hasVoted = await storage.hasUserVoted(voteData.submissionId, voteData.voterId);
      if (hasVoted) {
        return res.status(400).json({ error: "Already voted" });
      }
      
      const vote = await storage.createVote(voteData);
      
      res.json(vote);
    } catch (error) {
      res.status(400).json({ error: "Invalid vote data" });
    }
  });

  app.get("/api/submissions/:id/votes", async (req, res) => {
    try {
      const submissionId = parseInt(req.params.id);
      const votes = await storage.getVotes(submissionId);
      
      res.json(votes);
    } catch (error) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  return httpServer;
}
