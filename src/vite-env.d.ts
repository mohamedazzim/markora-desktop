/// <reference types="vite/client" />
import type { MarkoraApi } from './shared/contracts';
declare global { interface Window { markora: MarkoraApi; } }
