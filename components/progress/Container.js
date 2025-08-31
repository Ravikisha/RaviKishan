export const Container = ({ animationDuration, children, isFinished }) => (
    <div
      className='pointer-events-none z-50 relative'
      style={{
        opacity: isFinished ? 0 : 1,
        transition: `opacity ${animationDuration}ms linear`,
      }}
    >
      {children}
    </div>
  );