/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/src/__mocks__/electron.ts',
    '^backend/(.*)$': '<rootDir>/src/backend/$1',
    '^common/(.*)$': '<rootDir>/src/common/$1'
  }
}
