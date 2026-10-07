import type { Provider } from '../src/providers.js';

export function libraryProvider() {
  const state = { calls: 0 };
  const provider: Provider = {
    metadata: {
      id: 'library', name: 'Library', description: 'Synthetic books.',
      graphqlEndpoint: '/providers/library/graphql',
    },
    routes: async app => {
      app.get('/graphql', async () => ({ description: 'Library documentation.' }));
      app.post('/graphql', async req => { state.calls++; return { received: req.body }; });
      app.get('/books', async () => ({ title: 'Example' }));
    },
  };
  return { provider, state };
}

export function weatherProvider(): Provider {
  return {
    metadata: {
      id: 'weather', name: 'Weather', description: 'Synthetic weather.',
      graphqlEndpoint: '/providers/weather/graphql',
    },
    routes: async app => {
      app.get('/graphql', async () => ({ description: 'Weather documentation.' }));
      app.post('/graphql', async () => ({ data: { observation: { celsius: 12.5, station: 'north' } } }));
    },
  };
}
