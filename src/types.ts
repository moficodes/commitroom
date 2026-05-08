export type TaskCategory = 'Work' | 'Code' | 'Design' | 'Study' | 'Other';
export type SessionType = 'work' | 'break' | 'idle';

export interface Commitment {
  id: string;
  username: string;
  task: string;
  category: TaskCategory;
  durationMinutes: number;
  timestamp: string;
}

export interface CompletedCommitment extends Commitment {
  completedAt: string;
  isSuccess: boolean;
}

export interface UserState {
  username: string;
  currentCommitment: Commitment | null;
  timeLeft: number; // in seconds
  sessionType: SessionType;
  pomosCompleted: number;
}
