import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  serviceSecret: process.env.SERVICE_SECRET || 'dev-internal-secret-key-123',
  logLevel: process.env.LOG_LEVEL || 'info',

  llmProvider: process.env.LLM_PROVIDER || 'ollama', // 'ollama' | 'azure-openai'

  ollama: {
    endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
  },

  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    apiKey: process.env.AZURE_OPENAI_KEY || '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
  }
};
