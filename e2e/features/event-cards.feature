Feature: Event cards
  On an event tile a card is drawn and shown to all players.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn

  Scenario: The dividend card appears as a popup and brings money
    Given the next card from the deck is "Dividende"
    And the dice sequence is 3+4
    When Anna rolls
    Then Anna and Ben see the event card "Dividende"
    When Anna closes the event card
    Then Anna has a balance of 2'050

  Scenario: The card has a Continue button, takes the focus and stays in the log
    Given the next card from the deck is "Dividende"
    And the dice sequence is 3+4
    When Anna rolls
    Then Anna and Ben see the event card "Dividende"
    And the keyboard focus of Anna is on "the card heading"
    And the Continue button of Anna is at least 44 pixels high
    When Anna presses Continue on the event card
    Then Anna no longer sees the event card
    And Anna has a balance of 2'050
    And the log of Anna contains "Dividende"
