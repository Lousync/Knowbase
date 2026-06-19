#!/usr/bin/env python3
import argparse
import secrets
import string

def build_charset(use_lower, use_upper, use_digits, use_symbols):
    chars = ""
    if use_lower:
        chars += string.ascii_lowercase
    if use_upper:
        chars += string.ascii_uppercase
    if use_digits:
        chars += string.digits
    if use_symbols:
        chars += "!@#$%^&*()-_=+[]{}:,.?"
    return chars

def generate_password(length, use_lower, use_upper, use_digits, use_symbols):
    if length <= 0:
        raise ValueError("length must be positive")

    charset = build_charset(use_lower, use_upper, use_digits, use_symbols)
    if not charset:
        raise ValueError("at least one character class must be enabled")

    # Ensure at least one character from each selected class.
    required = []
    if use_lower:
        required.append(secrets.choice(string.ascii_lowercase))
    if use_upper:
        required.append(secrets.choice(string.ascii_uppercase))
    if use_digits:
        required.append(secrets.choice(string.digits))
    if use_symbols:
        required.append(secrets.choice("!@#$%^&*()-_=+[]{}:,.?"))

    if length < len(required):
        raise ValueError("length is smaller than the number of selected classes")

    remaining = [secrets.choice(charset) for _ in range(length - len(required))]
    password_chars = required + remaining
    secrets.SystemRandom().shuffle(password_chars)
    return "".join(password_chars)


def main():
    parser = argparse.ArgumentParser(description="Generate a strong password")
    parser.add_argument("-l", "--length", type=int, default=16, help="password length")
    parser.add_argument("--no-lower", action="store_true", help="disable lowercase")
    parser.add_argument("--no-upper", action="store_true", help="disable uppercase")
    parser.add_argument("--no-digits", action="store_true", help="disable digits")
    parser.add_argument("--no-symbols", action="store_true", help="disable symbols")
    args = parser.parse_args()

    password = generate_password(
        length=args.length,
        use_lower=not args.no_lower,
        use_upper=not args.no_upper,
        use_digits=not args.no_digits,
        use_symbols=not args.no_symbols,
    )

    print(password)


if __name__ == "__main__":
    main()
