import React from 'react';
import { Box, Text } from 'ink';
import { redactSecrets } from '../src/util/redact.js';

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions anywhere in the tree so a single bad frame can't
 * throw an uncaught exception and leave the terminal in raw mode. Instead we show
 * a plain, redacted fallback and tell the user their work on disk is safe.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      const msg = redactSecrets(error.message || String(error));
      return (
        <Box flexDirection="column" padding={1} gap={1}>
          <Text color="red" bold>
            handoff hit an unexpected error and paused this screen.
          </Text>
          <Text>{msg}</Text>
          <Text dimColor>
            Your projects, config, and session are safe on disk. Press Ctrl-C to exit,
            then relaunch (handoff --resume) to continue.
          </Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
