export interface PostRecord {
  id: string;
  subreddit?: string;
  title?: string;
  author?: string;
  permalink?: string;
  url?: string;
  bodyText?: string;
  score?: number;
  numComments?: number;
  createdUtc?: string;
}

export interface CommentRecord {
  id: string;
  postId: string;
  parentId?: string | null;
  author?: string;
  bodyText?: string;
  bodyHtml?: string;
  permalink?: string;
  url?: string;
  depth?: number;
  score?: number;
  createdUtc?: string;
  parentExcerpt?: string | null;
  note?: string | null;
  source?: 'manual' | 'bulk' | 'selection';
}

export interface PageContext {
  url: string;
  isPostPage: boolean;
  post: PostRecord | null;
  comments: CommentRecord[];
}

export type RetrievalScope = 'page' | 'page+library' | 'library';

export interface Citation {
  id: string;
  author: string;
  url: string;
  excerpt: string;
  origin: 'page' | 'library';
  postTitle?: string;
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface DbSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface RetrievalSettings {
  scope: RetrievalScope;
  pageFullThreshold: number;
  pageTopK: number;
  libraryTopK: number;
  maxCommentChars: number;
}

export interface CommentListItem {
  id: string;
  postId: string;
  author: string | null;
  bodyText: string | null;
  permalink: string | null;
  url: string | null;
  score: number | null;
  depth: number | null;
  note: string | null;
  source: string;
  createdUtc: string | null;
  savedAt: string;
  postTitle: string | null;
  subreddit: string | null;
  tags: string[];
}
