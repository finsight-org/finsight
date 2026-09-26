import { createSchema } from 'graphql-yoga';

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Query {
      """A greeting from the FinSight API."""
      hello: String!
    }
  `,
  resolvers: {
    Query: {
      hello: () => 'FinSight',
    },
  },
});
