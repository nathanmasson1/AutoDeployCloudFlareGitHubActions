interface FullScreenMessageProps {
  title: string;
  body: string;
}

export function FullScreenMessage({ title, body }: FullScreenMessageProps) {
  return (
    <main className="login-screen">
      <div className="login-card">
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
    </main>
  );
}
