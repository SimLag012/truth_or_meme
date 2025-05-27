import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and } from "drizzle-orm";
import { 
  users,
  rooms,
  roomPlayers,
  gameSubmissions,
  gameVotes,
  type User, 
  type InsertUser,
  type Room,
  type InsertRoom,
  type RoomPlayer,
  type InsertRoomPlayer,
  type GameSubmission,
  type InsertGameSubmission,
  type GameVote,
  type InsertGameVote
} from "@shared/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Room operations
  createRoom(room: InsertRoom, hostId: number): Promise<Room>;
  getRoom(id: string): Promise<Room | undefined>;
  updateRoom(id: string, updates: Partial<Room>): Promise<Room | undefined>;
  deleteRoom(id: string): Promise<void>;
  
  // Room player operations
  joinRoom(roomPlayer: InsertRoomPlayer): Promise<RoomPlayer>;
  getRoomPlayers(roomId: string): Promise<(RoomPlayer & { user: User })[]>;
  leaveRoom(roomId: string, userId: number): Promise<void>;
  updatePlayerScore(roomId: string, userId: number, score: number): Promise<void>;
  
  // Game submission operations
  createSubmission(submission: InsertGameSubmission): Promise<GameSubmission>;
  getSubmission(roomId: string, round: number): Promise<GameSubmission | undefined>;
  
  // Game vote operations
  createVote(vote: InsertGameVote): Promise<GameVote>;
  getVotes(submissionId: number): Promise<(GameVote & { voter: User })[]>;
  hasUserVoted(submissionId: number, voterId: number): Promise<boolean>;
}

export class DbStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values({
      ...insertUser,
      createdAt: new Date()
    }).returning();
    return result[0];
  }

  // Room operations
  async createRoom(insertRoom: InsertRoom, hostId: number): Promise<Room> {
    const result = await db.insert(rooms).values({
      ...insertRoom,
      hostId,
      status: "waiting",
      currentRound: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    return result[0];
  }

  async getRoom(id: string): Promise<Room | undefined> {
    const result = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
    return result[0];
  }

  async updateRoom(id: string, updates: Partial<Room>): Promise<Room | undefined> {
    const result = await db.update(rooms)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(rooms.id, id))
      .returning();
    return result[0];
  }

  async deleteRoom(id: string): Promise<void> {
    await db.delete(rooms).where(eq(rooms.id, id));
  }

  // Room player operations
  async joinRoom(roomPlayer: InsertRoomPlayer): Promise<RoomPlayer> {
    const result = await db.insert(roomPlayers).values({
      ...roomPlayer,
      score: 0,
      joinedAt: new Date()
    }).returning();
    return result[0];
  }

  async getRoomPlayers(roomId: string): Promise<(RoomPlayer & { user: User })[]> {
    const result = await db.select({
      id: roomPlayers.id,
      roomId: roomPlayers.roomId,
      userId: roomPlayers.userId,
      score: roomPlayers.score,
      joinedAt: roomPlayers.joinedAt,
      user: users,
    })
    .from(roomPlayers)
    .innerJoin(users, eq(roomPlayers.userId, users.id))
    .where(eq(roomPlayers.roomId, roomId));
    
    return result;
  }

  async leaveRoom(roomId: string, userId: number): Promise<void> {
    await db.delete(roomPlayers)
      .where(and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.userId, userId)));
  }

  async updatePlayerScore(roomId: string, userId: number, score: number): Promise<void> {
    await db.update(roomPlayers)
      .set({ score })
      .where(and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.userId, userId)));
  }

  // Game submission operations
  async createSubmission(submission: InsertGameSubmission): Promise<GameSubmission> {
    const result = await db.insert(gameSubmissions).values({
      ...submission,
      createdAt: new Date()
    }).returning();
    return result[0];
  }

  async getSubmission(roomId: string, round: number): Promise<GameSubmission | undefined> {
    const result = await db.select().from(gameSubmissions)
      .where(and(eq(gameSubmissions.roomId, roomId), eq(gameSubmissions.round, round)))
      .limit(1);
    return result[0];
  }

  // Game vote operations
  async createVote(vote: InsertGameVote): Promise<GameVote> {
    const result = await db.insert(gameVotes).values({
      ...vote,
      createdAt: new Date()
    }).returning();
    return result[0];
  }

  async getVotes(submissionId: number): Promise<(GameVote & { voter: User })[]> {
    const result = await db.select({
      id: gameVotes.id,
      submissionId: gameVotes.submissionId,
      voterId: gameVotes.voterId,
      guessedType: gameVotes.guessedType,
      isCorrect: gameVotes.isCorrect,
      createdAt: gameVotes.createdAt,
      voter: users,
    })
    .from(gameVotes)
    .innerJoin(users, eq(gameVotes.voterId, users.id))
    .where(eq(gameVotes.submissionId, submissionId));
    
    return result;
  }

  async hasUserVoted(submissionId: number, voterId: number): Promise<boolean> {
    const result = await db.select().from(gameVotes)
      .where(and(eq(gameVotes.submissionId, submissionId), eq(gameVotes.voterId, voterId)))
      .limit(1);
    return result.length > 0;
  }
}

export const storage = new DbStorage();
