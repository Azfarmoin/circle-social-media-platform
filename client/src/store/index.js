import { configureStore } from '@reduxjs/toolkit';
import { reducers } from './slices.js';

export const makeStore = (preloadedState) => configureStore({ reducer: reducers, preloadedState });
export const store = makeStore();
