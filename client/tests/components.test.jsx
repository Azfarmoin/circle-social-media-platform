import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { makeStore } from '../src/store/index.js';
import { RichText, PollView } from '../src/components/post/parts.jsx';
import { Login } from '../src/pages/auth/Auth.jsx';
import { Field, ConfirmDialog } from '../src/components/ui/index.jsx';
import { upsertPosts } from '../src/store/slices.js';

const wrap = (ui, store = makeStore()) => render(<Provider store={store}><MemoryRouter>{ui}</MemoryRouter></Provider>);

describe('RichText', () => {
  it('links hashtags and mentions and renders markup as inert text', () => {
    const { container } = wrap(<RichText text={'Hello @sara #fun <img src=x onerror=alert(1)>'} />);
    expect(screen.getByRole('link', { name: '@sara' })).toHaveAttribute('href', '/u/sara');
    expect(screen.getByRole('link', { name: '#fun' })).toHaveAttribute('href', '/hashtag/fun');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('opens external links safely', () => {
    wrap(<RichText text="see https://example.com" />);
    const a = screen.getByRole('link', { name: 'https://example.com' });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });
});

describe('PollView', () => {
  const base = { _id: 'p1', poll: { question: 'Tabs or spaces?', multiple: false, ended: false, totalVotes: 4, myVote: [], options: [{ _id: 'a', text: 'Tabs', count: 1 }, { _id: 'b', text: 'Spaces', count: 3 }] } };
  it('shows choices until you vote, then percentages', () => {
    const store = makeStore();
    store.dispatch(upsertPosts([base]));
    const { rerender } = wrap(<PollView post={base} />, store);
    expect(screen.getByRole('button', { name: 'Tabs' })).toBeInTheDocument();
    rerender(<Provider store={store}><MemoryRouter><PollView post={{ ...base, poll: { ...base.poll, myVote: ['b'] } }} /></MemoryRouter></Provider>);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tabs' })).toBeNull();
  });
  it('shows final results for ended polls', () => {
    wrap(<PollView post={{ ...base, poll: { ...base.poll, ended: true } }} />);
    expect(screen.getByText(/final results/)).toBeInTheDocument();
  });
});

describe('Login form', () => {
  it('validates required fields before calling the API', async () => {
    wrap(<Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter your email or username')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
  });
  it('labels inputs so they are reachable by assistive tech', () => {
    wrap(<Login />);
    expect(screen.getByLabelText('Email or username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
});

describe('ui primitives', () => {
  it('Field associates its label and error with the control', () => {
    render(<Field label="Name" error="Required"><input /></Field>);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
  it('ConfirmDialog runs the action and closes', async () => {
    const onConfirm = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="Delete?" message="Sure?" confirmLabel="Delete" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalled();
  });
  it('ConfirmDialog closes on Escape', async () => {
    const onClose = vi.fn();
    render(<ConfirmDialog open title="Delete?" message="Sure?" onConfirm={() => {}} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
