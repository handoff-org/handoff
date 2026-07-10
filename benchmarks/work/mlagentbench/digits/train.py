# Baseline: train a classifier on the (bundled) sklearn digits dataset.
# Improve the model to maximize test accuracy, then re-run this script.
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

X, y = load_digits(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0)

# Baseline model — a simple, underpowered classifier. Improve me.
model = LogisticRegression(max_iter=1000, solver='lbfgs', C=1.0)
model.fit(X_train, y_train)

acc = accuracy_score(y_test, model.predict(X_test))
print(f"Test Accuracy: {acc:.4f}")
