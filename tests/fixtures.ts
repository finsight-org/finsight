import { GraphQLError, GraphQLScalarType } from 'graphql';
import { createSchema } from 'graphql-yoga';
import type { ProviderContext, ProviderDefinition } from '../src/providers.js';

export function libraryProvider() {
  const state = { calls: 0, contexts: [] as ProviderContext[] };
  const provider: ProviderDefinition = {
    id: 'library',
    name: 'Library',
    description: 'Synthetic books and publication dates.',
    mode: 'schema',
    schema: createSchema<ProviderContext>({
      typeDefs: `
        scalar PublicationDate
        type Record { title: String!, published: PublicationDate! }
        type Query {
          "Find a synthetic book by title."
          book(title: String!): Record!
          unavailable: String
          broken: String
        }
      `,
      resolvers: {
        PublicationDate: new GraphQLScalarType({
          name: 'PublicationDate',
          serialize: (value) => {
            if (!(value instanceof Date)) throw new Error('Expected a Date');
            return value.toISOString().slice(0, 10);
          },
        }),
        Query: {
          book: async (_parent, { title }: { title: string }, context) => {
            state.calls++;
            state.contexts.push(context);
            await Promise.resolve();
            return { title, published: new Date('2001-02-03T00:00:00Z') };
          },
          unavailable: () => {
            throw new GraphQLError('Book temporarily unavailable.', {
              extensions: { code: 'BOOK_UNAVAILABLE' },
            });
          },
          broken: () => { throw new Error('PRIVATE diagnostic and token'); },
        },
      },
    }),
  };
  return { provider, state };
}

export function weatherProvider(): ProviderDefinition {
  return {
    id: 'weather',
    name: 'Weather',
    description: 'Synthetic weather observations.',
    mode: 'schema',
    schema: createSchema({
      typeDefs: `
        type Record { celsius: Float!, station: String! }
        type Query { observation: Record! }
      `,
      resolvers: { Query: { observation: () => ({ celsius: 12.5, station: 'north' }) } },
    }),
  };
}
