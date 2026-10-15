import type { RequestHandler } from 'expo-router/server';
import { staffActivation } from '../../../server/staff-activation';
export const GET: RequestHandler = staffActivation;
export const POST: RequestHandler = staffActivation;
