import pandas as pd
import sys

def score_output(csv_path, truth_excel_path):
    print(f"Loading generated CSV: {csv_path}")
    try:
        df_csv = pd.read_csv(csv_path)
    except FileNotFoundError:
        print(f"Error: Could not find {csv_path}")
        return

    print(f"Loading ground truth Excel: {truth_excel_path}")
    try:
        df_truth = pd.read_excel(truth_excel_path, skiprows=15) # Skipping headers to get to observations
    except Exception as e:
        print(f"Error loading excel: {e}")
        return
        
    print("--- SCORECARD ---")
    # This will be populated with fuzzy matching logic once we have the CSV
    print(f"Total exceptions in Truth: {len(df_truth)}")
    print(f"Total exceptions Found by App: {len(df_csv)}")
    print("\nWaiting for the CSV output to run the full comparison!")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python scorer.py <app_output.csv> <truth_sheet.xlsx>")
    else:
        score_output(sys.argv[1], sys.argv[2])
