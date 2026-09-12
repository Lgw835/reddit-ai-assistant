export interface PostRecord {
  id: string;
  subreddit?: string | null;
  title?: string | null;
  author?: string | null;
  permalink?: string | null;
  url?: string | null;
  bodyText?: string | null;
  score?: number | null;
  numComments?: number | null;
  createdUtc?: string | null;
}

export interface CommentRecord {
  id: string;
  postId: string;
  parentId?: string | null;
  author?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  permalink?: string | null;
  url?: string | null;
  depth?: number | null;
  score?: number | null;
  createdUtc?: string | null;
  parentExcerpt?: string | null;
  note?: string | null;
  source?: 'manual' | 'bulk' | 'selection';
}

/** 页面实时采集、尚未入库的评论 */
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

export interface PageContext {
  url?: string;
  post?: PostRecord | null;
  comments: PageComment[];
}

export interface Citation {
  id: string;
  author: string;
  url: string;
  excerpt: string;
  origin: 'page' | 'library';
}
