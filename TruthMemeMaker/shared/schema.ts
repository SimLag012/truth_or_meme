import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  hostId: integer("host_id").references(() => users.id).notNull(),
  status: text("status").notNull().default("waiting"), // waiting, playing, finished
  currentPlayerId: integer("current_player_id").references(() => users.id),
  currentRound: integer("current_round").default(1).notNull(),
  maxRounds: integer("max_rounds").default(5).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const roomPlayers = pgTable("room_players", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").references(() => rooms.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  score: integer("score").default(0).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const gameSubmissions = pgTable("game_submissions", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").references(() => rooms.id).notNull(),
  playerId: integer("player_id").references(() => users.id).notNull(),
  round: integer("round").notNull(),
  phrase: text("phrase").notNull(),
  actualType: text("actual_type").notNull(), // truth or meme
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const gameVotes = pgTable("game_votes", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").references(() => gameSubmissions.id).notNull(),
  voterId: integer("voter_id").references(() => users.id).notNull(),
  guessedType: text("guessed_type").notNull(), // truth or meme
  isCorrect: boolean("is_correct").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  displayName: true,
});

export const insertRoomSchema = createInsertSchema(rooms).pick({
  id: true,
  maxRounds: true,
});

export const insertRoomPlayerSchema = createInsertSchema(roomPlayers).pick({
  roomId: true,
  userId: true,
});

export const insertGameSubmissionSchema = createInsertSchema(gameSubmissions).pick({
  roomId: true,
  playerId: true,
  round: true,
  phrase: true,
  actualType: true,
});

export const insertGameVoteSchema = createInsertSchema(gameVotes).pick({
  submissionId: true,
  voterId: true,
  guessedType: true,
  isCorrect: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof rooms.$inferSelect;
export type InsertRoomPlayer = z.infer<typeof insertRoomPlayerSchema>;
export type RoomPlayer = typeof roomPlayers.$inferSelect;
export type InsertGameSubmission = z.infer<typeof insertGameSubmissionSchema>;
export type GameSubmission = typeof gameSubmissions.$inferSelect;
export type InsertGameVote = z.infer<typeof insertGameVoteSchema>;
export type GameVote = typeof gameVotes.$inferSelect;
