import os
from app.codebase_indexer import query_codebase

def test():
    # Write a dummy ruby file
    os.makedirs("dummy_workspace", exist_ok=True)
    with open("dummy_workspace/test.rb", "w") as f:
        f.write("class User\n  def hello\n    puts 'world'\n  end\nend\n")

    print("Testing ChromaDB Query...")
    results = query_codebase("hello", "dummy_workspace", n_results=1)

    print("Results:")
    for r in results:
        print(f"File: {r['file']}")
        print(f"Content: {r['content']}")

if __name__ == "__main__":
    test()
