export interface PageComment {
  id: string;
  postId?: string;
  parentId?: string | null;
  author?: string | null;
  bodyText?: string | null;
  permalink?: string | null;
  depth?: number | null;
  score?: number | null;
  createdUtc?: string | null;
}

export interface RetrievalCandidate {
  id: string;
  author: string;
  text: string;
  url: string;
  postTitle: string;
  subreddit: string;
  note: string;
  score: number;
  origin: 'page' | 'library';
  rank: number;
}
