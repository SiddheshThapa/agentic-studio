"""Create the first developer account so someone can log in and use the
Users screen to add everyone else. Run once per environment:

    python seed_admin.py you@studio.com

Prompts for a password (not passed on the command line, so it doesn't end up
in shell history). Refuses to overwrite an existing account with that email.
"""
import getpass
import sys

from app.core.auth import hash_password
from app.data.database import create_user, get_user_by_email, init_tables


def main():
    if len(sys.argv) != 2:
        print("usage: python seed_admin.py <email>")
        sys.exit(1)

    email = sys.argv[1]
    init_tables()

    if get_user_by_email(email) is not None:
        print(f"A user with email {email} already exists.")
        sys.exit(1)

    password = getpass.getpass("Password for the new developer account: ")
    if len(password) < 8:
        print("Password must be at least 8 characters.")
        sys.exit(1)

    password_hash, salt = hash_password(password)
    user_id = create_user(email, password_hash, salt, "developer")
    print(f"Created developer account #{user_id} ({email}).")


if __name__ == "__main__":
    main()
