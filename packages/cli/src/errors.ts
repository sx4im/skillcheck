export class SkillcheckError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
    readonly exitCode = 1,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends SkillcheckError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'INVALID_INPUT', false, 2, options);
  }
}

export class ConfigError extends SkillcheckError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'INVALID_CONFIG', false, 1, options);
  }
}

export class AuthError extends SkillcheckError {
  constructor(message = 'Provider rejected the configured credentials.', options?: ErrorOptions) {
    super(message, 'AUTH_FAILED', false, 1, options);
  }
}

export class ProviderRateLimitError extends SkillcheckError {
  constructor(options?: ErrorOptions) {
    super('The provider rate limit was reached. Retry later or reduce concurrency.', 'RATE_LIMIT', true, 1, options);
  }
}

export class ProviderTimeoutError extends SkillcheckError {
  constructor(options?: ErrorOptions) {
    super('The provider request timed out. Retry or increase SKILLCHECK_TIMEOUT_MS.', 'PROVIDER_TIMEOUT', true, 1, options);
  }
}

export class ProviderResponseError extends SkillcheckError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'INVALID_PROVIDER_RESPONSE', false, 1, options);
  }
}

export class ProviderHttpError extends SkillcheckError {
  constructor(message: string, readonly status?: number, retryable = false, options?: ErrorOptions) {
    super(message, 'PROVIDER_REQUEST_FAILED', retryable, 1, options);
  }
}

export class SecurityGateError extends SkillcheckError {
  constructor(message: string) {
    super(message, 'SECURITY_GATE', false, 4);
  }
}

export class IoError extends SkillcheckError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'IO_ERROR', false, 1, options);
  }
}
