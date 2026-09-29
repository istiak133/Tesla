import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../config/env.validation.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from './auth.errors.js';
import { AuthService } from './auth.service.js';
import type { PublicUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { SessionAuthGuard } from './guards/session-auth.guard.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie.js';

// At most 5 sign-up or login attempts per minute from one client.
const AUTH_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // POST /auth/signup → 201, sets the session cookie
  @Post('signup')
  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_RATE_LIMIT)
  async signup(
    @Body() body: SignupDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicUser> {
    try {
      const result = await this.authService.signup(
        body.name,
        body.email,
        body.password,
      );
      this.setSessionCookie(response, result.sessionToken);
      return result.user;
    } catch (error) {
      if (
        error instanceof EmailAlreadyRegisteredError ||
        isUniqueViolation(error)
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  // POST /auth/login → 200, sets the session cookie
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_RATE_LIMIT)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicUser> {
    try {
      const result = await this.authService.login(body.email, body.password);
      this.setSessionCookie(response, result.sessionToken);
      return result.user;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  // POST /auth/logout → 204, deletes the session and the cookie
  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = request.cookies[SESSION_COOKIE_NAME] as string;
    await this.authService.logout(token);
    response.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  }

  // GET /auth/me → the logged-in user
  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }

  private setSessionCookie(response: Response, token: string) {
    const isProduction =
      this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Production;
    const ttlHours = this.config.get('SESSION_TTL_HOURS', { infer: true });
    response.cookie(
      SESSION_COOKIE_NAME,
      token,
      sessionCookieOptions(isProduction, ttlHours),
    );
  }
}

// P2002 = Prisma's code for "a unique constraint was violated".
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
