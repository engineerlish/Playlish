import { describe, expect, it, vi } from 'vitest';
import { SpotifyClient } from '../src/main/spotify/client';
import { RequestQueue } from '../src/main/spotify/queue';

describe('SpotifyClient.withCommandPriority (#102)', () => {
  it('sends commands and library changes at the given priority, through the same queue and cache', async () => {
    const queue = new RequestQueue();
    const priorities: string[] = [];
    const run = queue.run.bind(queue);
    vi.spyOn(queue, 'run').mockImplementation((job) => {
      priorities.push(`${job.endpoint} ${job.priority}`);
      return run(job);
    });
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const user = new SpotifyClient({ getAccessToken: () => Promise.resolve('token'), queue, fetch });
    const background = user.withCommandPriority('background');

    await user.next();
    await background.next();
    await background.saveToLibrary(['spotify:track:1']);

    expect(background.queue).toBe(user.queue);
    expect(background.cache).toBe(user.cache);
    expect(priorities).toEqual(['POST /me/player/next user', 'POST /me/player/next background', 'PUT /me/library background']);
  });
});
