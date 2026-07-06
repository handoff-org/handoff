import numpy as np

np.random.seed(42)
x = np.linspace(-10, 10, 200)
y = 3 * x + np.random.normal(scale=1.5, size=x.shape)

# Fit linear regression y = a*x + b using least squares
A = np.vstack([x, np.ones_like(x)]).T
slope, intercept, _, _, _ = np.linalg.lstsq(A, y, rcond=None)
r_squared = 1 - np.sum((y - A @ [slope, intercept])**2) / np.sum((y - np.mean(y))**2)

print(f"Slope: {slope:.6f}")
print(f"Intercept: {intercept:.6f}")
print(f"R²: {r_squared:.6f}")
