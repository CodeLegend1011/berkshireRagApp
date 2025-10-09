// src/config/openai.ts
import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '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';

export const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export default openai;