import 'dotenv/config';

function getEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function getEnvOptional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const env = {
  PORT: parseInt(getEnvOptional('PORT', '3000'), 10),
  DATABASE_URL: getEnv('DATABASE_URL'),
  OPENAI_API_KEY: getEnv('OPENAI_API_KEY'),
  ZAPI_BASE_URL: getEnvOptional('ZAPI_BASE_URL', 'https://api.z-api.io'),
  ZAPI_INSTANCE_ID: getEnv('ZAPI_INSTANCE_ID'),
  ZAPI_TOKEN: getEnv('ZAPI_TOKEN'),
  ZAPI_CLIENT_TOKEN: getEnv('ZAPI_CLIENT_TOKEN'),
  DOCTOR_PHONE: normalizePhone(getEnv('DOCTOR_PHONE')),
};

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}
