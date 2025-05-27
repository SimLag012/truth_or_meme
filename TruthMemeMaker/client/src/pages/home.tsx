import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { User, Room, RoomPlayer } from '@shared/schema';

type GameState = 'welcome' | 'lobby' | 'playing' | 'voting' | 'results';
type UserRole = 'host' | 'player';

export default function Home() {
  // Game state management
  const [gameState, setGameState] = useState<GameState>('welcome');
  const [user, setUser] = useState<User | null>(null);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('player');
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  
  // Form inputs
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [phrase, setPhrase] = useState('');
  const [selectedType, setSelectedType] = useState<'truth' | 'meme'>('truth');
  
  // Toast for user feedback
  const { toast } = useToast();

  /**
   * Create user account
   */
  const createUserMutation = useMutation({
    mutationFn: async (userData: { username: string; displayName: string }) => {
      return apiRequest(`/api/users`, {
        method: 'POST',
        body: JSON.stringify(userData),
      });
    },
    onSuccess: (newUser: User) => {
      setUser(newUser);
      setGameState('lobby');
      toast({
        title: "Welcome!",
        description: `Account created for ${newUser.displayName}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    },
  });

  /**
   * Create a new game room
   */
  const createRoomMutation = useMutation({
    mutationFn: async (roomData: { id: string; maxRounds: number }) => {
      return apiRequest(`/api/rooms`, {
        method: 'POST',
        body: JSON.stringify({
          ...roomData,
          hostId: user?.id,
        }),
      });
    },
    onSuccess: (room: Room) => {
      setCurrentRoom(room);
      setUserRole('host');
      setGameState('lobby');
      connectToRoom(room.id);
      toast({
        title: "Room Created!",
        description: `Room ${room.id} is ready for players`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create room",
        variant: "destructive",
      });
    },
  });

  /**
   * Join an existing room
   */
  const joinRoomMutation = useMutation({
    mutationFn: async (roomId: string) => {
      // First get room info
      const roomData = await apiRequest(`/api/rooms/${roomId}`);
      
      // Then join the room
      await apiRequest(`/api/rooms/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({ userId: user?.id }),
      });
      
      return roomData;
    },
    onSuccess: (room: Room) => {
      setCurrentRoom(room);
      setUserRole('player');
      setGameState('lobby');
      connectToRoom(room.id);
      toast({
        title: "Joined Room!",
        description: `Welcome to room ${room.id}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to join room",
        variant: "destructive",
      });
    },
  });

  /**
   * Get room data with players
   */
  const { data: roomData, refetch: refetchRoom } = useQuery({
    queryKey: ['/api/rooms', currentRoom?.id],
    queryFn: () => apiRequest(`/api/rooms/${currentRoom?.id}`),
    enabled: !!currentRoom?.id,
    refetchInterval: 2000, // Poll every 2 seconds for updates
  });

  /**
   * Connect to WebSocket for real-time updates
   */
  const connectToRoom = (roomId: string) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join_room',
        roomId,
        userId: user?.id
      }));
      setWebsocket(ws);
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'player_joined':
          refetchRoom();
          toast({
            title: "Player Joined",
            description: "A new player has joined the room",
          });
          break;
        case 'game_started':
          setGameState('playing');
          refetchRoom();
          break;
        case 'new_submission':
          setGameState('voting');
          refetchRoom();
          break;
      }
    };
    
    ws.onclose = () => {
      setWebsocket(null);
    };
  };

  /**
   * Start the game (host only)
   */
  const startGameMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/rooms/${currentRoom?.id}/start`, {
        method: 'POST',
        body: JSON.stringify({ hostId: user?.id }),
      });
    },
    onSuccess: () => {
      setGameState('playing');
      toast({
        title: "Game Started!",
        description: "Let the Truth or Meme Battle begin!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start game",
        variant: "destructive",
      });
    },
  });

  /**
   * Submit a phrase
   */
  const submitPhraseMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/submissions`, {
        method: 'POST',
        body: JSON.stringify({
          roomId: currentRoom?.id,
          playerId: user?.id,
          round: currentRoom?.currentRound || 1,
          phrase: phrase.trim(),
          actualType: selectedType,
        }),
      });
    },
    onSuccess: () => {
      setPhrase('');
      setGameState('voting');
      toast({
        title: "Phrase Submitted!",
        description: "Other players are now voting",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit phrase",
        variant: "destructive",
      });
    },
  });

  /**
   * Handle form submissions
   */
  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && displayName.trim()) {
      createUserMutation.mutate({ username: username.trim(), displayName: displayName.trim() });
    }
  };

  const handleCreateRoom = () => {
    if (roomId.trim()) {
      createRoomMutation.mutate({ id: roomId.trim(), maxRounds: 5 });
    }
  };

  const handleJoinRoom = () => {
    if (roomId.trim()) {
      joinRoomMutation.mutate(roomId.trim());
    }
  };

  const handleSubmitPhrase = (e: React.FormEvent) => {
    e.preventDefault();
    if (phrase.trim()) {
      submitPhraseMutation.mutate();
    }
  };

  /**
   * Generate random room ID
   */
  const generateRoomId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomId(result);
  };

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [websocket]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-100 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header Section */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-800 mb-4 tracking-tight">
            Truth or Meme Battle
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Multiplayer fun! Submit phrases and guess if they're truths or funny memes!
          </p>
        </div>

        {/* Welcome Screen - Create Account */}
        {gameState === 'welcome' && (
          <Card className="rounded-3xl shadow-xl border-gray-200 mb-8">
            <CardHeader>
              <CardTitle className="text-3xl text-center">Welcome! Let's Get Started</CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <form onSubmit={handleCreateAccount} className="space-y-6">
                <div>
                  <label className="block text-lg font-semibold text-gray-700 mb-3">
                    Username (unique):
                  </label>
                  <Input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter a unique username..."
                    className="w-full px-4 py-3 text-lg"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-lg font-semibold text-gray-700 mb-3">
                    Display Name:
                  </label>
                  <Input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="How should others see you..."
                    className="w-full px-4 py-3 text-lg"
                    required
                  />
                </div>

                <div className="text-center">
                  <Button
                    type="submit"
                    disabled={createUserMutation.isPending}
                    className="bg-gradient-to-r from-primary to-purple-600 hover:from-purple-600 hover:to-primary text-white font-bold py-4 px-8 rounded-xl text-lg"
                  >
                    {createUserMutation.isPending ? 'Creating Account...' : '🚀 Create Account & Play'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Lobby - Room Management */}
        {gameState === 'lobby' && !currentRoom && (
          <Card className="rounded-3xl shadow-xl border-gray-200 mb-8">
            <CardHeader>
              <CardTitle className="text-3xl text-center">Hey {user?.displayName}! 👋</CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <div className="grid md:grid-cols-2 gap-8">
                {/* Create Room */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold text-center">Create New Room</h3>
                  <div>
                    <label className="block text-lg font-semibold text-gray-700 mb-3">
                      Room ID:
                    </label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                        placeholder="ROOM123"
                        className="flex-1 px-4 py-3 text-lg"
                        maxLength={10}
                      />
                      <Button
                        onClick={generateRoomId}
                        variant="outline"
                        className="px-4 py-3"
                      >
                        🎲 Random
                      </Button>
                    </div>
                  </div>
                  <Button
                    onClick={handleCreateRoom}
                    disabled={createRoomMutation.isPending || !roomId.trim()}
                    className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-6 rounded-xl"
                  >
                    {createRoomMutation.isPending ? 'Creating...' : '🏠 Create Room'}
                  </Button>
                </div>

                <Separator orientation="vertical" className="hidden md:block" />
                <hr className="md:hidden" />

                {/* Join Room */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold text-center">Join Existing Room</h3>
                  <div>
                    <label className="block text-lg font-semibold text-gray-700 mb-3">
                      Room ID:
                    </label>
                    <Input
                      type="text"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                      placeholder="Enter room code..."
                      className="w-full px-4 py-3 text-lg"
                      maxLength={10}
                    />
                  </div>
                  <Button
                    onClick={handleJoinRoom}
                    disabled={joinRoomMutation.isPending || !roomId.trim()}
                    className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-4 px-6 rounded-xl"
                  >
                    {joinRoomMutation.isPending ? 'Joining...' : '🚪 Join Room'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Room Lobby - Waiting for Players */}
        {gameState === 'lobby' && currentRoom && (
          <Card className="rounded-3xl shadow-xl border-gray-200 mb-8">
            <CardHeader>
              <CardTitle className="text-3xl text-center">
                Room: {currentRoom.id}
                <Badge className="ml-3" variant={currentRoom.status === 'waiting' ? 'secondary' : 'default'}>
                  {currentRoom.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              {/* Players List */}
              <div className="mb-6">
                <h3 className="text-xl font-bold mb-4">Players ({roomData?.players?.length || 0}):</h3>
                <div className="grid gap-3">
                  {roomData?.players?.map((player: RoomPlayer & { user: User }) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
                          {player.user.displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold">{player.user.displayName}</span>
                        {player.userId === currentRoom.hostId && (
                          <Badge variant="default">Host</Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-500">Score</div>
                        <div className="font-bold text-lg">{player.score}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Game Controls */}
              {userRole === 'host' && (
                <div className="text-center space-y-4">
                  <p className="text-gray-600">
                    Need at least 2 players to start the game!
                  </p>
                  <Button
                    onClick={() => startGameMutation.mutate()}
                    disabled={startGameMutation.isPending || (roomData?.players?.length || 0) < 2}
                    className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-8 rounded-xl"
                  >
                    {startGameMutation.isPending ? 'Starting...' : '🎮 Start Game'}
                  </Button>
                </div>
              )}
              
              {userRole === 'player' && (
                <div className="text-center">
                  <p className="text-gray-600">Waiting for host to start the game...</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Playing - Submit Phrase */}
        {gameState === 'playing' && (
          <Card className="rounded-3xl shadow-xl border-gray-200 mb-8">
            <CardHeader>
              <CardTitle className="text-3xl text-center">
                Round {currentRoom?.currentRound} - Your Turn!
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <form onSubmit={handleSubmitPhrase} className="space-y-6">
                <div>
                  <label className="block text-lg font-semibold text-gray-700 mb-4">
                    Choose your strategy:
                  </label>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <Button
                      type="button"
                      variant={selectedType === 'truth' ? 'default' : 'outline'}
                      onClick={() => setSelectedType('truth')}
                      className="h-16"
                    >
                      <div>
                        <div className="text-2xl mb-1">✋</div>
                        <div>Truth</div>
                        <div className="text-xs opacity-70">Something true but embarrassing</div>
                      </div>
                    </Button>
                    <Button
                      type="button"
                      variant={selectedType === 'meme' ? 'default' : 'outline'}
                      onClick={() => setSelectedType('meme')}
                      className="h-16"
                    >
                      <div>
                        <div className="text-2xl mb-1">😂</div>
                        <div>Meme</div>
                        <div className="text-xs opacity-70">Funny lie that sounds plausible</div>
                      </div>
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="block text-lg font-semibold text-gray-700 mb-3">
                    Your phrase:
                  </label>
                  <Input
                    type="text"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder={
                      selectedType === 'truth' 
                        ? "Share something true but embarrassing about yourself..."
                        : "Create a funny, believable lie about yourself..."
                    }
                    className="w-full px-4 py-3 text-lg"
                    maxLength={200}
                    required
                  />
                  <div className="mt-2 text-right text-sm text-gray-500">
                    {phrase.length}/200 characters
                  </div>
                </div>

                <div className="text-center">
                  <Button
                    type="submit"
                    disabled={submitPhraseMutation.isPending || !phrase.trim()}
                    className="bg-gradient-to-r from-primary to-purple-600 hover:from-purple-600 hover:to-primary text-white font-bold py-4 px-8 rounded-xl"
                  >
                    {submitPhraseMutation.isPending ? 'Submitting...' : '📝 Submit Phrase'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Voting/Results Placeholder */}
        {gameState === 'voting' && (
          <Card className="rounded-3xl shadow-xl border-gray-200 mb-8">
            <CardHeader>
              <CardTitle className="text-3xl text-center">Voting Time! 🗳️</CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <div className="text-center">
                <p className="text-xl mb-6">Other players are voting on your phrase...</p>
                <div className="animate-pulse">
                  <div className="bg-gray-200 h-8 rounded mb-4"></div>
                  <div className="bg-gray-200 h-6 rounded w-3/4 mx-auto"></div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-gray-500 text-sm mt-12">
          <p>Built with ❤️ for multiplayer fun and laughter</p>
        </div>
      </div>
    </div>
  );
}
