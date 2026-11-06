Feature: Rolling, moving and buying properties
  As a player I want to roll, move to a tile and buy it
  so that I own streets and can collect rent.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn

  Scenario: Anna buys the street she landed on
    Given the dice sequence is 2+4
    When Anna rolls
    Then Anna is offered the chance to buy "Weggisgasse"
    When Anna buys the property
    Then Anna has a balance of 1'900
    And Anna owns "Weggisgasse"
    And Anna can end her turn

  Scenario: The buy offer shows rent, colour progress and the balance after buying
    Given the dice sequence is 2+4
    When Anna rolls
    Then Anna is offered the chance to buy "Weggisgasse"
    And Anna sees a rent of 4 in the buy offer
    And Anna sees the colour progress "Luzern: 1 von 3" in the buy offer
    And Anna sees a balance of 1'900 after buying in the buy offer

  Scenario: The buy offer tells when the purchase completes the colour set
    Given Anna already owns "Pilatusstrasse" and "Kapellbrücke"
    And the dice sequence is 2+4
    When Anna rolls
    Then Anna is offered the chance to buy "Weggisgasse"
    And Anna sees a rent of 8 in the buy offer
    And Anna sees the colour progress "Luzern: 3 von 3 · komplett" in the buy offer
    And Anna sees a balance of 1'900 after buying in the buy offer

  Scenario: Ben pays Anna rent
    Given Anna already owns "Weggisgasse"
    And it is Ben's turn
    And the dice sequence is 2+4
    When Ben rolls
    Then Ben has a balance of 1'996
    And Anna has a balance of 2'004
    And Anna sees that Ben has a balance of 1'996

  Scenario: Doubles give Anna another roll
    Given Anna already owns "Weggisgasse"
    And the dice sequence is 2+4, 3+3
    When Anna rolls
    Then Anna can end her turn
