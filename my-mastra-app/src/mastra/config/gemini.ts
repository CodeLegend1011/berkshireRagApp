/**
 * Minimal Gemini wrapper.
 */

import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_EMBED_MODEL = process.env.DEFAULT_EMBED_MODEL || "text-embedding-004";
const DEFAULT_GEN_MODEL = process.env.DEFAULT_GEN_MODEL || "gemini-2.0-flash-exp";

if (!API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set in environment");
}

type EmbeddingResponse = {
    embedding: number[];
    model: string;
};

export async function getEmbedding(text: string, model = DEFAULT_EMBED_MODEL): Promise<EmbeddingResponse> {
    try {
        // FIX: Use correct Gemini API format with API key as query parameter
        const url = `${API_BASE}/models/${encodeURIComponent(model)}:embedContent?key=${API_KEY}`;
        
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
                content: {
                    parts: [{
                        text: text
                    }]
                }
            }),
        });

        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`Gemini embed error ${resp.status}: ${txt}`);
        }

        const payload = await resp.json();
        
        // Gemini embedContent response structure: { embedding: { values: [...] } }
        const embedding: number[] = payload?.embedding?.values || [];

        if (!Array.isArray(embedding) || embedding.length === 0) {
            throw new Error("Gemini embedding returned empty vector. Inspect response shape.");
        }

        return { embedding, model };
    } catch (err) {
        console.error("getEmbedding error:", err);
        throw err;
    }
}

/**
 * Streaming generator for token-by-token output.
 */
export async function* generateStream(
    prompt: string,
    model = DEFAULT_GEN_MODEL,
    temperature = 0.0
): AsyncGenerator<string> {
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?key=${API_KEY}`;
    
    const body = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            temperature,
            maxOutputTokens: 1024,
        }
    };

    const resp = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok || !resp.body) {
        const txt = await resp.text();
        throw new Error(`Gemini generate error ${resp.status}: ${txt}`);
    }

    const reader = (resp.body as any).getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            
            const lines = chunk.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        yield text;
                    }
                } catch {
                    // Skip invalid JSON lines
                }
            }
        }
    } finally {
        reader.releaseLock?.();
    }
}

/**
 * Non-streaming generate helper
 */
export async function generate(prompt: string, model = DEFAULT_GEN_MODEL, temperature = 0.0): Promise<string> {
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${API_KEY}`;
    
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
                temperature,
                maxOutputTokens: 1024,
            }
        }),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Gemini generate error ${resp.status}: ${txt}`);
    }
    
    const payload = await resp.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text;
}

export default {
    getEmbedding,
    generate,
    generateStream,
};