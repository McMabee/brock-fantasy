import { resolvePublicDeploymentConfig } from '../config/public-deployment.cjs';
import { verifyPublishedSportsRpcs } from './lib/published-sports-rpcs.mjs';

const config = resolvePublicDeploymentConfig({ ...process.env, VERCEL: '1' });
const names = await verifyPublishedSportsRpcs(config);
console.log(`Published sports RPCs deployed and anonymous execution denied: ${names.join(', ')}`);
