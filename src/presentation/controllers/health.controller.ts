import { Controller, Get } from '@nestjs/common';
import { Public } from '../http/http-context';

export const API_VERSION = '1.0.0';

@Controller('health')
export class HealthController {
  /** GET /health · público. */
  @Get()
  @Public()
  health(): { status: string; version: string; time: string } {
    return { status: 'ok', version: API_VERSION, time: new Date().toISOString() };
  }
}
