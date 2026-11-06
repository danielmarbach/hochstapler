Feature: Debt and bankruptcy
  Whoever owes money is told whom and how much is missing. Giving up is irreversible, so it has to be confirmed
  in a dialog of the game that starts on the safe answer.

  Background:
    Given Anna and Ben play a game in Switzerland

  Scenario: The debt notice names the creditor and what is still missing
    Given Ben has cash of 20
    And Ben owes Anna 500
    Then Ben sees the debt notice "Du schuldest Anna CHF 500 · es fehlen CHF 480"

  Scenario: The debt notice names the bank
    Given Ben has cash of 20
    And Ben owes the bank 500
    Then Ben sees the debt notice "Du schuldest der Bank CHF 500 · es fehlen CHF 480"

  Scenario: Nothing is missing once the cash covers the debt
    Given Ben has cash of 600
    And Ben owes Anna 500
    Then the debt notice of Ben says nothing is missing

  Scenario: Bankruptcy asks first and starts on Cancel
    Given Ben has cash of 20
    And Ben owes Anna 500
    When Ben asks to declare bankruptcy
    Then Ben sees the bankruptcy confirmation
    And the keyboard focus of Ben is on "Cancel bankruptcy"
    And Ben can tab 4 times without leaving the open dialog

  Scenario: Escape keeps the player in the game
    Given Ben has cash of 20
    And Ben owes Anna 500
    When Ben asks to declare bankruptcy
    And Ben presses Escape
    Then the bankruptcy confirmation of Ben is closed
    And Ben sees the notice that he has to raise money
    And the keyboard focus of Ben is on "the bankruptcy button"

  Scenario: Cancelling keeps the player in the game
    Given Ben has cash of 20
    And Ben owes Anna 500
    When Ben asks to declare bankruptcy
    And Ben cancels the bankruptcy
    Then the bankruptcy confirmation of Ben is closed
    And Ben sees the notice that he has to raise money

  @mobile
  Scenario: Giving up from the phone sheet is confirmed as well
    Given Ben has cash of 20
    And Ben owes Anna 500
    When Ben asks to give up from the sheet
    Then Ben sees the bankruptcy confirmation
    And the keyboard focus of Ben is on "Cancel bankruptcy"
    When Ben confirms the bankruptcy
    Then Anna sees that Anna wins the game

  @desktop
  Scenario: The give-up flag of the desktop bar is confirmed too
    Given it is Anna's turn
    When Anna asks to give up with the flag
    Then Anna sees the bankruptcy confirmation
    When Anna cancels the bankruptcy
    Then the bankruptcy confirmation of Anna is closed
    And the keyboard focus of Anna is on "the give-up flag"
