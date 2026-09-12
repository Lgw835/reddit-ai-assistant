import type { FastifyInstance } from 'fastify';
import { loadConfig, saveConfig, redact, unmask, type LlmConfig, type RetrievalConfig } from '../config';
import { testLlm } from '../llm';
import { syncSettingsToDb } from './db';

interface SettingsBody {
  llm?: Partial<LlmConfig>;
  retrieval?: Partial<RetrievalConfig>;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    const cfg = await loadConfig();
    return redact(cfg);
  });

  app.put<{ Body: SettingsBody }>('/api/settings', async (req) => {
    const current = await loadConfig();
    const body = req.body ?? {};
    const llm: LlmConfig = {
      baseUrl: (body.llm?.baseUrl ?? current.llm.baseUrl).trim(),
      apiKey: unmask(body.llm?.apiKey, current.llm.apiKey),
      model: (body.llm?.model ?? current.llm.model).trim(),
      temperature: Number(body.llm?.temperature ?? current.llm.temperature),
    };
    const retrieval: RetrievalConfig = {
      scope: body.retrieval?.scope ?? current.retrieval.scope,
      pageFullThreshold: Number(body.retrieval?.pageFullThreshold ?? current.retrieval.pageFullThreshold),
      pageTopK: Number(body.retrieval?.pageTopK ?? current.retrieval.pageTopK),
      libraryTopK: Number(body.retrieval?.libraryTopK ?? current.retrieval.libraryTopK),
      maxCommentChars: Number(body.retrieval?.maxCommentChars ?? current.retrieval.maxCommentChars),
    };
    const next = await saveConfig({ llm, retrieval });
    await syncSettingsToDb().catch(() => {});
    return redact(next);
  });

  app.post<{ Body: { llm?: Partial<LlmConfig> } }>('/api/settings/test-llm', async (req, reply) => {
    const current = await loadConfig();
    const incoming = req.body?.llm ?? {};
    const cfg: LlmConfig = {
      baseUrl: (incoming.baseUrl ?? current.llm.baseUrl).trim(),
      apiKey: unmask(incoming.apiKey, current.llm.apiKey),
      model: (incoming.model ?? current.llm.model).trim(),
      temperature: Number(incoming.temperature ?? current.llm.temperature),
    };
    try {
      const res = await testLlm(cfg);
      return { ok: true, sample: res.sample };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
