import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

describe('App', () => {
  it('renders without crashing', () => {
    // If it uses routing (stakes.io uses BrowserRouter internally, but if not we might need it, actually Stakes.io App already has <Router>, so we just render <App />)
    const { baseElement } = render(<App />);
    expect(baseElement).toBeDefined();
  });
});