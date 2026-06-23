import { BadRequestException, ConflictException } from '@nestjs/common';
import { retryOnConflict } from './retry.util';

describe('retryOnConflict', () => {
  it('returns immediately on success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(retryOnConflict(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on ConflictException then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException('insufficient'))
      .mockRejectedValueOnce(new ConflictException('insufficient'))
      .mockResolvedValue('ok');
    await expect(
      retryOnConflict(fn, { baseDelayMs: 1 }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-transient errors', async () => {
    const fn = jest
      .fn()
      .mockRejectedValue(new BadRequestException('genuine shortage'));
    await expect(retryOnConflict(fn, { baseDelayMs: 1 })).rejects.toThrow(
      'genuine shortage',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and rethrows', async () => {
    const fn = jest.fn().mockRejectedValue(new ConflictException('x'));
    await expect(
      retryOnConflict(fn, { attempts: 3, baseDelayMs: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
